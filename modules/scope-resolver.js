const { ROLES, LEVEL_TO_ROLE, ROLE_NAMES, ROLE_TO_LEVEL } = require("@modules/roles");

/**
 * Resolves the effective global scopes for a user.
 * Works with both the new role-based system and the legacy numeric permissions.
 *
 * @param {Object} user - User object from classStateStore or DB
 * @param {string} [user.role] - Named role (new system)
 * @param {number} [user.permissions] - Numeric permission level (legacy)
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
 * @param {string[]} [classUser.classRoles] - Array of assigned role names (new multi-role system)
 * @param {string} [classUser.classRole] - Single role name (legacy, backward compat)
 * @param {number} [classUser.classPermissions] - Numeric class permission level (legacy)
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

    // Start with Guest scopes as implicit base
    const allScopes = new Set(ROLES[ROLE_NAMES.GUEST].class);

    for (const roleName of roleNames) {
        if (roleName === ROLE_NAMES.GUEST) continue; // Already included as base

        // Check for per-class role scope overrides
        if (classroom && classroom.roleOverrides && classroom.roleOverrides[roleName]) {
            for (const scope of classroom.roleOverrides[roleName]) {
                allScopes.add(scope);
            }
            continue;
        }

        // Built-in role
        const roleDefinition = ROLES[roleName];
        if (roleDefinition) {
            for (const scope of roleDefinition.class) {
                allScopes.add(scope);
            }
            continue;
        }

        // Custom class role
        if (classroom && classroom.customRoles && classroom.customRoles[roleName]) {
            for (const scope of classroom.customRoles[roleName]) {
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
 * Prefers the explicit `role` field, falls back to mapping from numeric permissions.
 * @param {Object} user
 * @returns {string} Role name
 */
function getUserRoleName(user) {
    if (user.role && ROLES[user.role]) {
        return user.role;
    }
    if (typeof user.permissions === "number") {
        return LEVEL_TO_ROLE[user.permissions] || ROLE_NAMES.GUEST;
    }
    return ROLE_NAMES.GUEST;
}

/**
 * Derives the class role name from a class user object (backward compat — returns primary role).
 * Prefers the explicit `classRole` field, falls back to highest role in classRoles,
 * then mapping from numeric classPermissions.
 * @param {Object} classUser
 * @returns {string} Role name
 */
function getClassRoleName(classUser) {
    // If classRoles array exists and is populated, return the primary (highest) role
    if (Array.isArray(classUser.classRoles) && classUser.classRoles.length > 0) {
        let highest = null;
        let highestLevel = -1;
        for (const roleName of classUser.classRoles) {
            const level = ROLE_TO_LEVEL[roleName];
            if (level !== undefined && level > highestLevel) {
                highest = roleName;
                highestLevel = level;
            }
        }
        return highest || classUser.classRoles[0];
    }
    if (classUser.classRole) {
        return classUser.classRole;
    }
    if (typeof classUser.classPermissions === "number") {
        return LEVEL_TO_ROLE[classUser.classPermissions] || ROLE_NAMES.GUEST;
    }
    return ROLE_NAMES.GUEST;
}

/**
 * Returns all class role names for a class user.
 * Supports multi-role: returns the classRoles array if available,
 * falls back to single classRole, then numeric classPermissions.
 * @param {Object} classUser
 * @returns {string[]} Array of role names
 */
function getClassRoleNames(classUser) {
    if (Array.isArray(classUser.classRoles) && classUser.classRoles.length > 0) {
        return classUser.classRoles;
    }
    if (classUser.classRole) {
        return [classUser.classRole];
    }
    if (typeof classUser.classPermissions === "number") {
        const roleName = LEVEL_TO_ROLE[classUser.classPermissions];
        return roleName ? [roleName] : [];
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
