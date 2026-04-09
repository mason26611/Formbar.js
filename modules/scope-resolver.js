const { ROLES, ROLE_NAMES, ROLE_TO_LEVEL } = require("@modules/roles");
const { getRoleName, getRoleNames } = require("@modules/role-reference");

/**
 * Resolves the effective global scopes for a user.
 * Uses the role-based system via user_roles table.
 *
 * @param {Object} user - User object from classStateStore or DB
 * @param {string} [user.role] - Named role
 * @returns {string[]} Array of granted scope strings
 */
function resolveUserScopes(user) {
    if (!user) return [];

    // Manager implicitly has all scopes
    const roleName = getUserRoleName(user);
    if (roleName === ROLE_NAMES.MANAGER) {
        return getAllScopes();
    }

    const roleDefinition = ROLES[roleName];
    if (!roleDefinition) return [];

    return [...roleDefinition.global];
}

/**
 * Resolves the effective class scopes for a user within a specific class.
 * Supports multi-role: unions scopes from all assigned roles.
 * Guest scopes are always included as a base.
 * If user has Banned role and no role >= Teacher, returns [].
 *
 * @param {Object} classUser - The user's class-specific data (from classroom.students[email])
 * @param {Object} [classroom] - The classroom object (for per-class role overrides and custom roles)
 * @param {Array<string|{id: number, name: string}>} [classUser.classRoles] - Array of assigned roles (multi-role system)
 * @param {string} [classUser.classRole] - Single role name (backward compat)
 * @returns {string[]} Array of granted class scope strings
 */
function resolveClassScopes(classUser, classroom) {
    if (!classUser) return [];

    const roleNames = getClassRoleNames(classUser);

    // Manager in any role gets everything
    if (roleNames.includes(ROLE_NAMES.MANAGER)) {
        return getAllClassScopes();
    }

    // Banned override: if Banned is present and no role >= Teacher, suppress all scopes
    if (roleNames.includes(ROLE_NAMES.BANNED)) {
        const hasTeacherPlus = roleNames.some((r) => (ROLE_TO_LEVEL[r] ?? -1) >= ROLE_TO_LEVEL[ROLE_NAMES.TEACHER]);
        if (!hasTeacherPlus) {
            return [];
        }
    }

    // Start with Guest scopes as implicit base, preferring class-defined Guest when present.
    const classGuestScopes = classroom && classroom.customRoles && classroom.customRoles[ROLE_NAMES.GUEST];
    const allScopes = new Set(Array.isArray(classGuestScopes) ? classGuestScopes : ROLES[ROLE_NAMES.GUEST].class);

    for (const roleName of roleNames) {
        if (roleName === ROLE_NAMES.GUEST) continue; // Already included as base

        // Check for per-class role scope overrides
        if (classroom && classroom.roleOverrides && classroom.roleOverrides[roleName]) {
            for (const scope of classroom.roleOverrides[roleName]) {
                allScopes.add(scope);
            }
            continue;
        }

        // Class-scoped role (includes modified defaults and custom roles)
        if (classroom && classroom.customRoles && classroom.customRoles[roleName]) {
            for (const scope of classroom.customRoles[roleName]) {
                allScopes.add(scope);
            }
            continue;
        }

        // Fallback to static built-in defaults
        const roleDefinition = ROLES[roleName];
        if (roleDefinition) {
            for (const scope of roleDefinition.class) {
                allScopes.add(scope);
            }
        }
    }

    return [...allScopes];
}

/**
 * Checks if a user has a specific global scope.
 * @param {Object} user - User object
 * @param {string} scope - Scope string to check
 * @returns {boolean}
 */
function userHasScope(user, scope) {
    if (!user) return false;
    const roleName = getUserRoleName(user);
    if (roleName === ROLE_NAMES.MANAGER) return true;
    return resolveUserScopes(user).includes(scope);
}

/**
 * Checks if a class user has a specific class scope.
 * Supports multi-role: checks union of all assigned role scopes.
 * @param {Object} classUser - Class user object
 * @param {Object} [classroom] - Classroom object
 * @param {string} scope - Scope string to check
 * @returns {boolean}
 */
function classUserHasScope(classUser, classroom, scope) {
    if (!classUser) return false;
    const roleNames = getClassRoleNames(classUser);
    if (roleNames.includes(ROLE_NAMES.MANAGER)) return true;
    return resolveClassScopes(classUser, classroom).includes(scope);
}

/**
 * Derives the role name from a user object.
 * Uses the classRoles array (populated from user_roles table).
 * Returns the highest role in the hierarchy, or GUEST if none.
 * @param {Object} user
 * @returns {string} Role name
 */
function getUserRoleName(user) {
    if (!user) {
        return ROLE_NAMES.GUEST;
    }

    const globalRoles = Array.isArray(user.globalRoles) ? user.globalRoles : Array.isArray(user.roles) ? user.roles : [];

    if (globalRoles.length > 0) {
        let highest = null;
        let highestLevel = -1;
        for (const role of globalRoles) {
            const roleName = getRoleName(role);
            const level = ROLE_TO_LEVEL[roleName];
            if (level !== undefined && level > highestLevel) {
                highest = roleName;
                highestLevel = level;
            }
        }
        return highest || getRoleName(globalRoles[0]) || ROLE_NAMES.GUEST;
    }
    if (user.role && ROLES[user.role]) {
        return user.role;
    }
    if (typeof user.permissions === "number" && Number.isInteger(user.permissions)) {
        for (const [roleName, level] of Object.entries(ROLE_TO_LEVEL)) {
            if (level === user.permissions) {
                return roleName;
            }
        }
    }
    return ROLE_NAMES.GUEST;
}

/**
 * Derives the class role name from a class user object (backward compat — returns primary role).
 * Prefers the classRoles array (highest role in hierarchy),
 * falls back to explicit classRole field.
 * @param {Object} classUser
 * @returns {string} Role name
 */
function getClassRoleName(classUser) {
    if (!classUser) {
        return ROLE_NAMES.GUEST;
    }

    if (Array.isArray(classUser.classRoles) && classUser.classRoles.length > 0) {
        let highest = null;
        let highestLevel = -1;
        for (const role of classUser.classRoles) {
            const roleName = getRoleName(role);
            const level = ROLE_TO_LEVEL[roleName];
            if (level !== undefined && level > highestLevel) {
                highest = roleName;
                highestLevel = level;
            }
        }
        return highest || getRoleName(classUser.classRoles[0]) || ROLE_NAMES.GUEST;
    }
    if (classUser.classRole) {
        return classUser.classRole;
    }
    if (typeof classUser.classPermissions === "number" && Number.isInteger(classUser.classPermissions)) {
        for (const [roleName, level] of Object.entries(ROLE_TO_LEVEL)) {
            if (level === classUser.classPermissions) {
                return roleName;
            }
        }
    }
    return ROLE_NAMES.GUEST;
}

/**
 * Returns all class role names for a class user.
 * Uses the classRoles array if available, falls back to single classRole.
 * @param {Object} classUser
 * @returns {string[]} Array of role names
 */
function getClassRoleNames(classUser) {
    if (!classUser) {
        return [];
    }

    if (Array.isArray(classUser.classRoles) && classUser.classRoles.length > 0) {
        return getRoleNames(classUser.classRoles);
    }
    if (classUser.classRole) {
        return [classUser.classRole];
    }
    if (typeof classUser.classPermissions === "number" && Number.isInteger(classUser.classPermissions)) {
        const roleName = getClassRoleName(classUser);
        return roleName === ROLE_NAMES.GUEST ? [] : [roleName];
    }
    return [];
}

/**
 * Returns all possible global scope strings (for Manager bypass).
 * @returns {string[]}
 */
function getAllScopes() {
    const { SCOPES } = require("@modules/permissions");
    const scopes = [];
    function collect(obj) {
        for (const value of Object.values(obj)) {
            if (typeof value === "string") {
                scopes.push(value);
            } else if (typeof value === "object" && value !== null) {
                collect(value);
            }
        }
    }
    collect(SCOPES.GLOBAL);
    return scopes;
}

/**
 * Returns all class-level scope strings (for Manager class bypass).
 * @returns {string[]}
 */
function getAllClassScopes() {
    const { SCOPES } = require("@modules/permissions");
    const scopes = [];
    function collect(obj) {
        for (const value of Object.values(obj)) {
            if (typeof value === "string") {
                scopes.push(value);
            } else if (typeof value === "object" && value !== null) {
                collect(value);
            }
        }
    }
    collect(SCOPES.CLASS);
    return scopes;
}

module.exports = {
    resolveUserScopes,
    resolveClassScopes,
    userHasScope,
    classUserHasScope,
    getUserRoleName,
    getClassRoleName,
    getClassRoleNames,
    getAllClassScopes,
};
