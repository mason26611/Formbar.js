const { ROLE_NAMES, LEVEL_TO_ROLE } = require("@modules/roles");
const {
    SCOPES,
    computeGlobalPermissionLevel,
    computeClassPermissionLevel,
    getScopesFromRoleLike,
    hasGlobalAdminScope,
    MANAGER_PERMISSIONS,
} = require("@modules/permissions");
const { getRoleName, getRoleNames } = require("@modules/role-reference");
const AppError = require("@errors/app-error");
const { flattenObject } = require("@modules/util");

/**
 * Filters a resolved scope array down to unique string scope keys.
 * Used after scope-resolver has already expanded roles, overrides, and direct scope arrays.
 *
 * @param {Array<unknown>} scopes
 * @returns {string[]}
 */
function dedupeScopes(scopes) {
    return [...new Set(scopes.filter((scope) => typeof scope === "string"))];
}

function getGlobalRoleEntries(user) {
    if (!user) {
        return [];
    }

    if (Array.isArray(user.globalRoles) && user.globalRoles.length > 0) {
        return user.globalRoles;
    }

    if (Array.isArray(user.roles) && user.roles.length > 0) {
        return user.roles;
    }

    if (user.role) {
        return [user.role];
    }

    return [];
}

function getClassRoleEntries(classUser) {
    if (!classUser) {
        return [];
    }

    if (Array.isArray(classUser.classRoleRefs) && classUser.classRoleRefs.length > 0) {
        return classUser.classRoleRefs;
    }

    if (Array.isArray(classUser.classRoles) && classUser.classRoles.length > 0) {
        return classUser.classRoles;
    }

    if (classUser.classRole) {
        return [classUser.classRole];
    }

    return [];
}

function isClassOwner(classUser, classroom) {
    if (!classUser || !classroom) {
        return Boolean(classUser && classUser.isClassOwner);
    }

    return (
        classUser.isClassOwner === true ||
        (classUser.id != null && Number(classroom.owner) === Number(classUser.id)) ||
        (classUser.email && String(classroom.owner) === String(classUser.email))
    );
}

function getGlobalScopesForRole(role) {
    return getScopesFromRoleLike(role, "global");
}

function getClassScopesForRole(role, classroom) {
    const roleId = role && typeof role === "object" ? role.id : null;
    const roleName = getRoleName(role);
    if (roleName && classroom?.roleOverrides?.[roleName]) {
        return dedupeScopes(classroom.roleOverrides[roleName]);
    }
    if (roleId != null && classroom?.customRoles?.[roleId]) {
        return dedupeScopes(classroom.customRoles[roleId]);
    }
    if (roleName && classroom?.customRoles?.[roleName]) {
        return dedupeScopes(classroom.customRoles[roleName]);
    }

    const scopes = getScopesFromRoleLike(role, "class", {
        availableRoles: Array.isArray(classroom?.availableRoles) ? classroom.availableRoles : [],
    });

    if (scopes.length > 0) {
        return scopes;
    }

    return scopes;
}

function getUserScopes(user, classroom) {
    if (!user) {
        throw new AppError("No user defined");
    }

    const classId = classroom.id || user.activeClass;
    const scopes = {
        global: [],
        class: [],
    };

    // If the user has explicit globalScopes or classScopes arrays, use those directly (after deduping and checking for admin/block scopes).
    // Otherwise, resolve scopes from roles as normal.
    const rawGlobalScopes = Array.isArray(user.globalScopes)
        ? user.globalScopes
        : getGlobalRoleEntries(user)
              .map((role) => getGlobalScopesForRole(role))
              .flat();

    const globalScopes = dedupeScopes(rawGlobalScopes);
    const isGlobalAdmin = hasGlobalAdminScope(globalScopes);
    const isGlobalBanned = globalScopes.includes(SCOPES.GLOBAL.SYSTEM.BLOCKED);
    scopes.global = isGlobalAdmin ? getAllGlobalScopes() : isGlobalBanned ? [] : globalScopes;

    // If the user has explicit classScopes in their user object, use those directly after deduping, otherwise resolve from roles as normal.
    const rawClassScopes = Array.isArray(user.classScopes)
        ? user.classScopes
        : getClassRoleEntries(user)
              .map((role) => getClassScopesForRole(role))
              .flat();

    const classScopes = dedupeScopes(rawClassScopes);
    const isClassAdmin = classScopes.includes(SCOPES.CLASS.SYSTEM.ADMIN);
    const isClassBanned = classScopes.includes(SCOPES.CLASS.SYSTEM.BLOCKED);
    scopes.class = isClassAdmin ? getAllClassScopes() : isClassBanned ? [] : classScopes;

    return scopes;
}

// function resolveUserGlobalScopes(user) {
//     if (!user) return [];
//
//     if (Array.isArray(user.globalScopes)) {
//         const scopes = dedupeScopes(user.globalScopes);
//         return hasGlobalAdminScope(scopes) ? getAllGlobalScopes() : computeGlobalPermissionLevel(scopes) === 0 ? [] : scopes;
//     }
//
//     const scopes = [];
//     for (const role of getGlobalRoleEntries(user)) {
//         scopes.push(...getGlobalScopesForRole(role));
//     }
//
//     const resolvedScopes = dedupeScopes(scopes);
//     if (hasGlobalAdminScope(resolvedScopes)) {
//         return getAllGlobalScopes();
//     }
//
//     const unblockedScopes = resolvedScopes.filter((scope) => scope !== SCOPES.GLOBAL.SYSTEM.BLOCKED);
//     if (computeGlobalPermissionLevel(resolvedScopes) === 0 && computeGlobalPermissionLevel(unblockedScopes) < MANAGER_PERMISSIONS) {
//         return [];
//     }
//
//     return computeGlobalPermissionLevel(unblockedScopes) >= MANAGER_PERMISSIONS ? getAllGlobalScopes() : resolvedScopes;
// }
//
// function resolveClassScopes(classUser, classroom) {
//     if (!classUser) return [];
//
//     const globalScopes = resolveUserGlobalScopes(classUser);
//     const ownerBypass = isClassOwner(classUser, classroom);
//     const scopes = [];
//
//     if (Array.isArray(classUser.classScopes) && classUser.classScopes.length > 0) {
//         scopes.push(...classUser.classScopes);
//     } else {
//         for (const role of getClassRoleEntries(classUser)) {
//             scopes.push(...getClassScopesForRole(role, classroom));
//         }
//     }
//
//     const resolvedScopes = dedupeScopes(scopes);
//     const permissionLevel = computeClassPermissionLevel(resolvedScopes, {
//         isOwner: ownerBypass,
//         globalScopes,
//     });
//     const unblockedScopes = resolvedScopes.filter((scope) => scope !== SCOPES.CLASS.SYSTEM.BLOCKED);
//     const unblockedPermissionLevel = computeClassPermissionLevel(unblockedScopes, {
//         isOwner: ownerBypass,
//         globalScopes,
//     });
//
//     if (permissionLevel === 0 && unblockedPermissionLevel < TEACHER_PERMISSIONS && !ownerBypass) {
//         return [];
//     }
//
//     if (permissionLevel === 5 || unblockedPermissionLevel === 5) {
//         return getAllClassScopes();
//     }
//
//     return unblockedPermissionLevel >= TEACHER_PERMISSIONS ? unblockedScopes : resolvedScopes;
// }

function userHasScope(user, scope, classroom = null) {
    if (!user) return false;

    const userScopes = getUserScopes(user, classroom);    
    const scopes = classroom ? userScopes.global.concat(userScopes.class) : userScopes.global;
    if (hasGlobalAdminScope(scopes)) return true;
    return scopes.includes(scope);
}

function selectHighestRoleName(roles, domain, options = {}) {
    let highestName = null;
    let highestLevel = -1;

    for (const role of roles) {
        const roleName = getRoleName(role);
        if (!roleName) {
            continue;
        }

        const scopes = domain === "global" ? getGlobalScopesForRole(role) : getClassScopesForRole(role, options.classroom);
        const level =
            domain === "global"
                ? computeGlobalPermissionLevel(scopes)
                : computeClassPermissionLevel(scopes, {
                      isOwner: false,
                      globalScopes: options.globalScopes,
                  });

        if (level > highestLevel) {
            highestName = roleName;
            highestLevel = level;
        }
    }

    return highestName;
}

function getUserRoleName(user) {
    if (!user) {
        return ROLE_NAMES.GUEST;
    }

    const roles = getGlobalRoleEntries(user);
    if (roles.length > 0) {
        return selectHighestRoleName(roles, "global") || getRoleName(roles[0]) || ROLE_NAMES.GUEST;
    }

    if (user.role && typeof user.role === "string") {
        return user.role;
    }

    if (typeof user.permissions === "number" && Number.isInteger(user.permissions)) {
        return LEVEL_TO_ROLE[user.permissions] || ROLE_NAMES.GUEST;
    }

    const permissionLevel = computeGlobalPermissionLevel(getUserScopes(user).global);
    return LEVEL_TO_ROLE[permissionLevel] || ROLE_NAMES.GUEST;
}

function getClassRoleName(classUser, classroom) {
    if (!classUser) {
        return ROLE_NAMES.GUEST;
    }

    const roles = getClassRoleEntries(classUser);
    if (roles.length > 0) {
        return (
            selectHighestRoleName(roles, "class", {
                classroom,
                globalScopes: getUserScopes(classUser).global,
            }) ||
            getRoleName(roles[0]) ||
            ROLE_NAMES.GUEST
        );
    }

    if (classUser.classRole && typeof classUser.classRole === "string") {
        return classUser.classRole;
    }

    if (typeof classUser.classPermissions === "number" && Number.isInteger(classUser.classPermissions)) {
        return LEVEL_TO_ROLE[classUser.classPermissions] || ROLE_NAMES.GUEST;
    }

    return ROLE_NAMES.GUEST;
}

function getClassRoleNames(classUser) {
    if (!classUser) {
        return [];
    }

    const roles = getClassRoleEntries(classUser);
    if (roles.length > 0) {
        return getRoleNames(roles);
    }

    if (typeof classUser.classPermissions === "number" && Number.isInteger(classUser.classPermissions)) {
        const roleName = LEVEL_TO_ROLE[classUser.classPermissions];
        return roleName && roleName !== ROLE_NAMES.GUEST ? [roleName] : [];
    }

    return [];
}

function getAllGlobalScopes() {
    let scopes = flattenObject(SCOPES.GLOBAL);
    scopes = scopes.filter((scope) => scope !== SCOPES.GLOBAL.SYSTEM.BLOCKED);
    return scopes;
}

function getAllClassScopes() {
    let scopes = flattenObject(SCOPES.CLASS);
    scopes = scopes.filter((scopes) => scopes !== SCOPES.CLASS.SYSTEM.BLOCKED);
    return scopes;
}

module.exports = {
    getUserScopes,
    userHasScope,
    getUserRoleName,
    getClassRoleName,
    getClassRoleNames,
    isClassOwner,
    getAllClassScopes,
};
