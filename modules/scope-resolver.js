const { ROLES, LEVEL_TO_ROLE, ROLE_NAMES } = require("@modules/roles");

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
 * Checks class-specific role overrides first, then falls back to default role scopes.
 *
 * @param {Object} classUser - The user's class-specific data (from classroom.students[email])
 * @param {Object} [classroom] - The classroom object (for per-class role overrides)
 * @param {number} [classUser.classPermissions] - Numeric class permission level (legacy)
 * @param {string} [classUser.classRole] - Named class role (new system)
 * @returns {string[]} Array of granted class scope strings
 */
function resolveClassScopes(classUser, classroom) {
    if (!classUser) return [];

    const roleName = getClassRoleName(classUser);

    // Manager class role implicitly has all class scopes
    if (roleName === ROLE_NAMES.MANAGER) {
        return getAllClassScopes();
    }

    // Check for per-class role scope overrides
    if (classroom && classroom.roleOverrides && classroom.roleOverrides[roleName]) {
        return [...classroom.roleOverrides[roleName]];
    }

    const roleDefinition = ROLES[roleName];
    if (roleDefinition) return [...roleDefinition.class];

    // Check for custom class roles
    if (classroom && classroom.customRoles && classroom.customRoles[roleName]) {
        return [...classroom.customRoles[roleName]];
    }

    return [];
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
 * @param {Object} classUser - Class user object
 * @param {Object} [classroom] - Classroom object
 * @param {string} scope - Scope string to check
 * @returns {boolean}
 */
function classUserHasScope(classUser, classroom, scope) {
    if (!classUser) return false;
    const roleName = getClassRoleName(classUser);
    if (roleName === ROLE_NAMES.MANAGER) return true;
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
 * Derives the class role name from a class user object.
 * Prefers the explicit `classRole` field, falls back to mapping from numeric classPermissions.
 * @param {Object} classUser
 * @returns {string} Role name
 */
function getClassRoleName(classUser) {
    if (classUser.classRole) {
        return classUser.classRole;
    }
    if (typeof classUser.classPermissions === "number") {
        return LEVEL_TO_ROLE[classUser.classPermissions] || ROLE_NAMES.GUEST;
    }
    return ROLE_NAMES.GUEST;
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
    getAllClassScopes,
};
