const {
    CLASS_SOCKET_PERMISSION_MAPPER,
    GLOBAL_SOCKET_PERMISSIONS,
    CLASS_SOCKET_PERMISSIONS,
    SOCKET_EVENT_SCOPE_MAP,
} = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { dbGet } = require("@modules/database");
const { PASSIVE_SOCKETS } = require("@services/socket-updates-service");
const { camelCaseToNormal } = require("@modules/util");
const { userHasScope, classUserHasScope } = require("@modules/scope-resolver");
const AuthError = require("@errors/auth-error");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");

// For users who do not have teacher/manager permissions, then they can only access these endpoints when it's
// only affecting themselves.
const endpointWhitelistMap = ["getOwnedClasses", "getActiveClass"];

/**
 * Middleware to check if a user has the required global permission.
 * @param {string|number} permission - The required permission level for the user.
 * @returns {Function} Express middleware function.
 * @deprecated Use hasScope() instead for new endpoints.
 */
function hasPermission(permission) {
    return function (req, res, next) {
        if (!req.user || !req.user.email) {
            req.warnEvent("auth.perm_check.not_authenticated", "Permission check failed: User is not authenticated");
            throw new AuthError("User is not authenticated");
        }

        const user = classStateStore.getUser(req.user.email);
        if (!user) {
            req.warnEvent("auth.perm_check.user_not_found", `User not found for permission check: ${req.user.email}`, { email: req.user.email });
            throw new AuthError("User not found", { event: "permission.check.failed", reason: "user_not_found" });
        }

        if (user.permissions >= permission) {
            next();
        } else {
            req.warnEvent("auth.perm_check.forbidden", `User ${req.user.email} does not have permissions to access this resource`, {
                email: req.user.email,
                userPermissions: user.permissions,
                requiredPermissions: permission,
            });
            throw new ForbiddenError("You do not have permission to access this resource.", {
                event: "permission.check.failed",
                reason: "insufficient_permissions",
            });
        }
    };
}

/**
 * Middleware to check if a user has the required class permission.
 * @param {string|number} classPermission - The required permission level for the class.
 * @returns {Function} Express middleware function.
 * @deprecated Use hasClassScope() instead for new endpoints.
 */
function hasClassPermission(classPermission) {
    return async function (req, res, next) {
        const classId = req.params.id ?? req.user.activeClass;
        if (!classId) {
            throw new NotFoundError("You're not currently in a classroom.", { event: "permission.check.failed", reason: "class_not_found" });
        }

        if (req.params.id && req.user.activeClass && String(req.params.id) !== String(req.user.activeClass)) {
            throw new ForbiddenError("Class ID mismatch.", {
                event: "permission.check.failed",
                reason: "class_id_mismatch",
            });
        }

        const classroom = classStateStore.getClassroom(classId);
        const email = req.user.email;
        if (!email) {
            req.warnEvent("auth.class_perm_check.not_authenticated", "Class permission check failed: User is not authenticated");
            throw new AuthError("User not authenticated");
        }

        // If classroom is active in memory, check from memory
        if (classroom) {
            const user = classroom.students[email];
            if (!user) {
                req.warnEvent("auth.class_perm_check.user_not_in_class", `User ${email} not found in class ${classId}`, { email, classId });
                throw new AuthError("User not found in this class.", { event: "permission.check.failed", reason: "user_not_in_class" });
            }

            // Retrieve the permission level from the classroom's permissions
            const requiredPermissionLevel = typeof classPermission === "string" ? classroom.permissions[classPermission] : classPermission;

            if (user.classPermissions >= requiredPermissionLevel) {
                next();
            } else {
                req.warnEvent(
                    req,
                    "auth.class_perm_check.forbidden",
                    `User ${email} does not have permissions to access class resource in ${classId}`,
                    {
                        email,
                        classId,
                        userClassPermissions: user.classPermissions,
                        requiredPermissions: requiredPermissionLevel,
                    }
                );
                throw new ForbiddenError("Unauthorized", { event: "permission.check.failed", reason: "insufficient_class_permissions" });
            }
        } else {
            req.warnEvent("auth.class_perm_check.class_not_active", `Class permission check failed: Class ${classId} is not active`, {
                classId,
            });
            throw new ForbiddenError("This class is not currently active.", { event: "permission.check.failed", reason: "class_not_active" });
        }
    };
}

/**
 * Middleware to check if a user has a specific global scope.
 * Uses the new scope-based permission system with backward-compatible role resolution.
 * @param {string} scope - e.g. 'global.class.create'
 * @returns {Function} Express middleware function.
 */
function hasScope(scope) {
    return function (req, res, next) {
        if (!req.user || !req.user.email) {
            req.warnEvent("auth.scope_check.not_authenticated", "Scope check failed: User is not authenticated");
            throw new AuthError("User is not authenticated");
        }

        const user = classStateStore.getUser(req.user.email);
        if (!user) {
            req.warnEvent("auth.scope_check.user_not_found", `User not found for scope check: ${req.user.email}`, { email: req.user.email });
            throw new AuthError("User not found", { event: "permission.check.failed", reason: "user_not_found" });
        }

        if (userHasScope(user, scope)) {
            return next();
        }

        req.warnEvent("auth.scope_check.forbidden", `User ${req.user.email} lacks scope ${scope}`, {
            email: req.user.email,
            requiredScope: scope,
        });
        throw new ForbiddenError("You do not have permission to access this resource.", {
            event: "permission.check.failed",
            reason: "insufficient_scope",
            scope,
        });
    };
}

/**
 * Middleware to check if a user has a specific class-scoped permission.
 * Enforces that req.params.id matches the user's active class.
 * @param {string} scope - e.g. 'class.poll.create'
 * @returns {Function} Express middleware function.
 */
function hasClassScope(scope) {
    return async function (req, res, next) {
        if (!req.user || !req.user.email) {
            req.warnEvent("auth.class_scope_check.not_authenticated", "Class scope check failed: User is not authenticated");
            throw new AuthError("User is not authenticated");
        }

        const classId = req.params.id;
        if (!classId) {
            throw new NotFoundError("Class ID is required.", { event: "permission.check.failed", reason: "class_not_found" });
        }

        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) {
            throw new ForbiddenError("This class is not currently active.", { event: "permission.check.failed", reason: "class_not_active" });
        }

        const email = req.user.email;
        const classUser = classroom.students[email];
        if (!classUser) {
            req.warnEvent("auth.class_scope_check.user_not_in_class", `User ${email} not in class ${classId}`, { email, classId });
            throw new AuthError("User not found in this class.", { event: "permission.check.failed", reason: "user_not_in_class" });
        }

        if (classUserHasScope(classUser, classroom, scope)) {
            return next();
        }

        req.warnEvent("auth.class_scope_check.forbidden", `User ${email} lacks class scope ${scope} in class ${classId}`, {
            email,
            classId,
            requiredScope: scope,
        });
        throw new ForbiddenError("Insufficient class permissions.", {
            event: "permission.check.failed",
            reason: "insufficient_class_scope",
            scope,
        });
    };
}

/**
 * Permission check for HTTP requests
 * This is used for using the same socket permissions for socket APIs for HTTP APIs.
 * @param {string} event
 * @returns {Promise<boolean>}
 * @deprecated Use hasScope()/hasClassScope() instead for new endpoints.
 */
function httpPermCheck(event) {
    return async function (req, res, next) {
        // Allow digipogs endpoints without permission checks (public API)
        if (req.path && req.path.startsWith("/digipogs/")) {
            return next();
        }

        const email = req.user.email;
        if (!email) {
            req.warnEvent("auth.http_perm_check.not_authenticated", "HTTP permission check failed: User is not authenticated");
            throw new AuthError("User not authenticated");
        }

        // Get classId from req.user (set by isAuthenticated middleware) or from classStateStore
        const classId = req.user?.classId ?? req.user?.activeClass ?? classStateStore.getUser(email)?.classId ?? null;

        if (req.params.id && classId && String(req.params.id) !== String(classId)) {
            throw new ForbiddenError("Class ID mismatch.", {
                event: "permission.check.failed",
                reason: "class_id_mismatch",
            });
        }

        if (!classStateStore.getClassroom(classId) && classId != null) {
            req.warnEvent("auth.http_perm_check.class_not_exist", `HTTP permission check failed: Class ${classId} does not exist`, { classId });
            throw new AuthError("Class does not exist", { event: "permission.check.failed", reason: "class_not_exist" });
        }

        if (CLASS_SOCKET_PERMISSION_MAPPER[event] && !classStateStore.getClassroom(classId)) {
            req.warnEvent(
                req,
                "auth.http_perm_check.class_not_loaded",
                `HTTP permission check failed: Class ${classId} is not loaded (mapper match)`,
                {
                    classId,
                    event,
                }
            );
            throw new AuthError("Class is not loaded", { event: "permission.check.failed", reason: "class_not_loaded" });
        }

        if (CLASS_SOCKET_PERMISSIONS[event] && !classStateStore.getClassroom(classId)) {
            req.warnEvent(
                req,
                "auth.http_perm_check.class_not_loaded",
                `HTTP permission check failed: Class ${classId} is not loaded (direct match)`,
                {
                    classId,
                    event,
                }
            );
            throw new AuthError("Class is not loaded");
        }

        let userData = classStateStore.getUser(email);
        if (!userData) {
            // Get the user data from the database
            userData = await dbGet("SELECT * FROM users WHERE email=?", [email]);
            if (!userData) {
                req.warnEvent("auth.http_perm_check.user_not_found", `User not found for HTTP permission check: ${email}`, { email });
                throw new AuthError("User not found");
            }
            userData.classPermissions = await dbGet("SELECT permissions FROM classUsers WHERE studentId=? AND classId=?", [userData.id, classId]);
        }

        // Try scope-based check first (via SOCKET_EVENT_SCOPE_MAP)
        const requiredScope = SOCKET_EVENT_SCOPE_MAP[event];
        if (requiredScope !== undefined) {
            // null scope means no permission required
            if (requiredScope === null) {
                return next();
            }

            // Global scope check
            if (requiredScope.startsWith("global.")) {
                if (userHasScope(userData, requiredScope)) {
                    return next();
                }
            }

            // Class scope check
            if (requiredScope.startsWith("class.") && classId) {
                const classroom = classStateStore.getClassroom(classId);
                const classUser = classroom?.students[email];
                if (classUser && classUserHasScope(classUser, classroom, requiredScope)) {
                    return next();
                }
            }
        }

        // Legacy fallback: numeric permission checks
        if (GLOBAL_SOCKET_PERMISSIONS[event] && userData.permissions >= GLOBAL_SOCKET_PERMISSIONS[event]) {
            return next();
        } else if (CLASS_SOCKET_PERMISSIONS[event] && userData.classPermissions >= CLASS_SOCKET_PERMISSIONS[event]) {
            return next();
        } else if (
            CLASS_SOCKET_PERMISSION_MAPPER[event] &&
            classStateStore.getClassroom(classId)?.permissions[CLASS_SOCKET_PERMISSION_MAPPER[event]] &&
            userData.classPermissions >= classStateStore.getClassroom(classId).permissions[CLASS_SOCKET_PERMISSION_MAPPER[event]]
        ) {
            return next();
        } else if (!PASSIVE_SOCKETS.includes(event)) {
            if (endpointWhitelistMap.includes(event)) {
                const id = req.params.id;
                const user = await dbGet("SELECT * FROM users WHERE email = ?", [email]);
                if (user && user.id == id) {
                    return next();
                }
            }

            req.warnEvent("auth.http_perm_check.forbidden", `User ${email} does not have permissions for event ${event}`, {
                email,
                event,
                userPermissions: userData.permissions,
                userClassPermissions: userData.classPermissions,
                classId,
            });
            throw new AuthError(`You do not have permission to use ${camelCaseToNormal(event)}.`, {
                event: "permission.check.failed",
                reason: "insufficient_permissions",
            });
        }

        return next();
    };
}

module.exports = {
    hasPermission,
    hasClassPermission,
    hasScope,
    hasClassScope,
    httpPermCheck,
};
