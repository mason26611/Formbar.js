const { ROLE_TO_LEVEL, ROLE_NAMES } = require("@modules/roles");
const { SCOPES, SOCKET_EVENT_SCOPE_MAP } = require("@modules/scopes");
const { getRoleName } = require("@modules/role-reference");

const BANNED_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.BANNED];
const GUEST_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.GUEST];
const STUDENT_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.STUDENT];
const MOD_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.MOD];
const TEACHER_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.TEACHER];
const MANAGER_PERMISSIONS = ROLE_TO_LEVEL[ROLE_NAMES.MANAGER];

/**
 * Computes a legacy numeric permission level from an array of role names.
 * Returns the highest ROLE_TO_LEVEL value among the roles.
 * Used for API backward compatibility only — never stored in the database.
 * @param {string[]} roleNames - Array of role name strings
 * @returns {number} The highest numeric permission level (0-5)
 */
function computePermissionLevel(roleNames) {
    if (!Array.isArray(roleNames) || roleNames.length === 0) {
        return ROLE_TO_LEVEL[ROLE_NAMES.GUEST] ?? 1;
    }

    let highest = 0;
    for (const role of roleNames) {
        const name = getRoleName(role);
        const level = ROLE_TO_LEVEL[name];
        if (level !== undefined && level > highest) {
            highest = level;
        }
    }
    return highest || (ROLE_TO_LEVEL[ROLE_NAMES.GUEST] ?? 1);
}

module.exports = {
    SCOPES,
    SOCKET_EVENT_SCOPE_MAP,
    computePermissionLevel,
    BANNED_PERMISSIONS,
    GUEST_PERMISSIONS,
    STUDENT_PERMISSIONS,
    MOD_PERMISSIONS,
    TEACHER_PERMISSIONS,
    MANAGER_PERMISSIONS,
};
