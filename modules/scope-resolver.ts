import type { RoleScopeSet } from "./roles";

const { ROLES, LEVEL_TO_ROLE, ROLE_NAMES } = require("@modules/roles") as {
    ROLES: Record<string, RoleScopeSet>;
    LEVEL_TO_ROLE: Record<number, string>;
    ROLE_NAMES: { BANNED: string; GUEST: string; STUDENT: string; MOD: string; TEACHER: string; MANAGER: string };
};

interface UserLike {
    role?: string;
    permissions?: number;
    [key: string]: unknown;
}

interface ClassUserLike {
    classRole?: string;
    classPermissions?: number;
    [key: string]: unknown;
}

interface ClassroomLike {
    roleOverrides?: Record<string, string[]>;
    [key: string]: unknown;
}

/**
 * Resolves the effective global scopes for a user.
 * Works with both the new role-based system and the legacy numeric permissions.
 */
function resolveUserScopes(user: UserLike | null | undefined): string[] {
    if (!user) return [];

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
 */
function resolveClassScopes(classUser: ClassUserLike | null | undefined, classroom?: ClassroomLike): string[] {
    if (!classUser) return [];

    const roleName = getClassRoleName(classUser);

    if (roleName === ROLE_NAMES.MANAGER) {
        return getAllClassScopes();
    }

    if (classroom && classroom.roleOverrides && classroom.roleOverrides[roleName]) {
        return [...classroom.roleOverrides[roleName]];
    }

    const roleDefinition = ROLES[roleName];
    if (!roleDefinition) return [];

    return [...roleDefinition.class];
}

/**
 * Checks if a user has a specific global scope.
 */
function userHasScope(user: UserLike | null | undefined, scope: string): boolean {
    if (!user) return false;
    const roleName = getUserRoleName(user);
    if (roleName === ROLE_NAMES.MANAGER) return true;
    return resolveUserScopes(user).includes(scope);
}

/**
 * Checks if a class user has a specific class scope.
 */
function classUserHasScope(classUser: ClassUserLike | null | undefined, classroom: ClassroomLike | undefined, scope: string): boolean {
    if (!classUser) return false;
    const roleName = getClassRoleName(classUser);
    if (roleName === ROLE_NAMES.MANAGER) return true;
    return resolveClassScopes(classUser, classroom).includes(scope);
}

/**
 * Derives the role name from a user object.
 * Prefers the explicit `role` field, falls back to mapping from numeric permissions.
 */
function getUserRoleName(user: UserLike): string {
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
 */
function getClassRoleName(classUser: ClassUserLike): string {
    if (classUser.classRole && ROLES[classUser.classRole]) {
        return classUser.classRole;
    }
    if (typeof classUser.classPermissions === "number") {
        return LEVEL_TO_ROLE[classUser.classPermissions] || ROLE_NAMES.GUEST;
    }
    return ROLE_NAMES.GUEST;
}

/**
 * Returns all possible global scope strings (for Manager bypass).
 */
function getAllScopes(): string[] {
    const { SCOPES } = require("@modules/permissions") as { SCOPES: Record<string, unknown> };
    const scopes: string[] = [];
    function collect(obj: Record<string, unknown>): void {
        for (const value of Object.values(obj)) {
            if (typeof value === "string") {
                scopes.push(value);
            } else if (typeof value === "object" && value !== null) {
                collect(value as Record<string, unknown>);
            }
        }
    }
    collect(SCOPES.GLOBAL as Record<string, unknown>);
    return scopes;
}

/**
 * Returns all class-level scope strings (for Manager class bypass).
 */
function getAllClassScopes(): string[] {
    const { SCOPES } = require("@modules/permissions") as { SCOPES: Record<string, unknown> };
    const scopes: string[] = [];
    function collect(obj: Record<string, unknown>): void {
        for (const value of Object.values(obj)) {
            if (typeof value === "string") {
                scopes.push(value);
            } else if (typeof value === "object" && value !== null) {
                collect(value as Record<string, unknown>);
            }
        }
    }
    collect(SCOPES.CLASS as Record<string, unknown>);
    return scopes;
}

module.exports = {
    resolveUserScopes,
    resolveClassScopes,
    userHasScope,
    classUserHasScope,
    getUserRoleName,
    getClassRoleName,
};
