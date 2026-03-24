import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/api";
import type { UserState, ClassroomState, ClassStudent } from "../types/stores";

const { classStateStore } = require("@services/classroom-service.js");
const { dbGet } = require("@modules/database.js") as {
    dbGet: <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T | undefined>;
};
const { userHasScope, classUserHasScope } = require("@modules/scope-resolver.js") as {
    userHasScope: (user: UserState | AuthenticatedRequest["user"], scope: string) => boolean;
    classUserHasScope: (classUser: ClassStudent, classroom: ClassroomState, scope: string) => boolean;
};
const AuthError = require("@errors/auth-error.js") as new (message: string, options?: Record<string, unknown>) => Error;
const ForbiddenError = require("@errors/forbidden-error.js") as new (message: string, options?: Record<string, unknown>) => Error;
const NotFoundError = require("@errors/not-found-error.js") as new (message: string, options?: Record<string, unknown>) => Error;

/**
 * Middleware to check if a user has a specific global scope.
 * Uses the new scope-based permission system with backward-compatible role resolution.
 */
function hasScope(scope: string) {
    return function (req: AuthenticatedRequest, res: Response, next: NextFunction): void {
        if (!req.user || !req.user.email) {
            req.warnEvent("auth.scope_check.not_authenticated", "Scope check failed: User is not authenticated");
            throw new AuthError("User is not authenticated");
        }

        const user: UserState | undefined = classStateStore.getUser(req.user.email);
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
 * Resolves class ID from req.params.id, req.user.classId, or req.user.activeClass.
 */
function hasClassScope(scope: string) {
    return async function (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        if (!req.user || !req.user.email) {
            req.warnEvent("auth.class_scope_check.not_authenticated", "Class scope check failed: User is not authenticated");
            throw new AuthError("User is not authenticated");
        }

        const classId = (req.params.id || req.user.classId || req.user.activeClass || "") as string | number;
        if (!classId) {
            throw new NotFoundError("Class ID is required.", { event: "permission.check.failed", reason: "class_not_found" });
        }

        const classroom: ClassroomState | undefined = classStateStore.getClassroom(classId);
        if (!classroom) {
            throw new ForbiddenError("This class is not currently active.", { event: "permission.check.failed", reason: "class_not_active" });
        }

        const email = req.user.email;
        const classUser: ClassStudent | undefined = classroom.students[email];
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
 * Middleware: allows access if the user is targeting themselves (req.params.id === req.user.id)
 * or if the user has the specified scope (e.g. manager/admin).
 */
function isSelfOrHasScope(scope: string, message?: string) {
    return function (req: AuthenticatedRequest, res: Response, next: NextFunction): void {
        if (!req.user || !req.user.email) {
            throw new AuthError("User is not authenticated");
        }

        const targetId = Number(req.params.id);
        if (req.user.id === targetId) {
            return next();
        }

        const user: UserState | AuthenticatedRequest["user"] = classStateStore.getUser(req.user.email) || req.user;
        if (userHasScope(user, scope)) {
            return next();
        }

        req.warnEvent("auth.self_or_scope.forbidden", `User ${req.user.email} is not target and lacks scope ${scope}`, {
            email: req.user.email,
            targetId,
            requiredScope: scope,
        });
        throw new ForbiddenError(message || "You do not have permission to access this resource.", {
            event: "permission.check.failed",
            reason: "not_self_and_insufficient_scope",
            scope,
        });
    };
}

/**
 * Middleware: allows access if the user owns the resource or has the specified scope.
 * The ownerCheck function receives (req) and must return a boolean (or promise of boolean).
 */
function isOwnerOrHasScope(
    ownerCheck: (req: AuthenticatedRequest) => boolean | Promise<boolean>,
    scope: string,
    message?: string,
) {
    return async function (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        if (!req.user || !req.user.email) {
            throw new AuthError("User is not authenticated");
        }

        const isOwner = await ownerCheck(req);
        if (isOwner) {
            return next();
        }

        const user: UserState | AuthenticatedRequest["user"] = classStateStore.getUser(req.user.email) || req.user;
        if (userHasScope(user, scope)) {
            return next();
        }

        req.warnEvent("auth.owner_or_scope.forbidden", `User ${req.user.email} is not owner and lacks scope ${scope}`, {
            email: req.user.email,
            requiredScope: scope,
        });
        throw new ForbiddenError(message || "You do not have permission to access this resource.", {
            event: "permission.check.failed",
            reason: "not_owner_and_insufficient_scope",
            scope,
        });
    };
}

/**
 * Middleware: checks if the user is a member of the class (enrolled in classusers or the class owner).
 * Resolves class ID from req.params.id, req.user.classId, or req.user.activeClass.
 * Does NOT require the class to be active in memory — checks the database.
 */
function isClassMember() {
    return async function (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        if (!req.user || !req.user.id) {
            throw new AuthError("User is not authenticated");
        }

        const classId = (req.params.id || req.user.classId || req.user.activeClass || "") as string | number;
        if (!classId) {
            throw new NotFoundError("Class ID is required.", { event: "permission.check.failed", reason: "class_not_found" });
        }

        // Check in-memory first (fast path)
        const classroom: ClassroomState | undefined = classStateStore.getClassroom(classId);
        if (classroom && classroom.students[req.user.email]) {
            return next();
        }

        // Fall back to database check
        const membership = await dbGet<Record<string, number>>("SELECT 1 FROM classusers WHERE studentId=? AND classId=?", [req.user.id, classId]);
        if (membership) {
            return next();
        }

        const ownership = await dbGet<Record<string, number>>("SELECT 1 FROM classroom WHERE id=? AND owner=?", [classId, req.user.id]);
        if (ownership) {
            return next();
        }

        throw new ForbiddenError("You are not a member of this class.", {
            event: "permission.check.failed",
            reason: "not_class_member",
        });
    };
}

module.exports = {
    hasScope,
    hasClassScope,
    isSelfOrHasScope,
    isOwnerOrHasScope,
    isClassMember,
};
