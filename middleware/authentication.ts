import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest, LoggedRequest } from "../types/api";
import type { UserRow, RefreshTokenRow } from "../types/database";
import type { UserState } from "../types/stores";
import type { Logger } from "winston";

const { getLogger } = require("@modules/logger.js");
const { classStateStore } = require("@services/classroom-service.js");
const { settings } = require("@modules/config.js");
const { GUEST_PERMISSIONS } = require("@modules/permissions.js");
const { dbGet, dbGetAll, dbRun } = require("@modules/database.js") as {
    dbGet: <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T | undefined>;
    dbGetAll: <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;
    dbRun: (query: string, params?: unknown[]) => Promise<number>;
};
const { compare } = require("@modules/crypto.js") as {
    compare: (text: string, hash: string) => Promise<boolean>;
};
const { createStudentFromUserData } = require("@services/student-service.js") as {
    createStudentFromUserData: (userData: Record<string, unknown>, options?: { isGuest?: boolean }) => UserState;
};
const { verifyToken, cleanupExpiredAuthorizationCodes } = require("@services/auth-service.js") as {
    verifyToken: (token: string) => DecodedToken;
    cleanupExpiredAuthorizationCodes: () => Promise<void>;
};
const { apiKeyCacheStore } = require("@stores/api-key-cache-store.js") as {
    apiKeyCacheStore: {
        get: (apiKey: string) => string | undefined;
        set: (apiKey: string, email: string) => void;
    };
};
const AuthError = require("@errors/auth-error.js") as new (message: string, options?: Record<string, unknown>) => Error;

const whitelistedIps: Record<string, boolean> = {};
const blacklistedIps: Record<string, boolean> = {};

interface DecodedToken {
    email?: string;
    error?: string;
    [key: string]: unknown;
}

// Removes expired refresh tokens and authorization codes from the database
async function cleanRefreshTokens(): Promise<void> {
    try {
        const refreshTokens = await dbGetAll<RefreshTokenRow>("SELECT * FROM refresh_tokens");
        for (const refreshToken of refreshTokens) {
            if (Date.now() >= refreshToken.exp) {
                await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ?", [refreshToken.token_hash]);
            }
        }
        // Also clean up expired authorization codes
        await cleanupExpiredAuthorizationCodes();
    } catch (err: unknown) {
        const logger: Logger = await getLogger();
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error({
            event: "auth.cleanup.error",
            message: "Failed to clean up expired refresh tokens or authorization codes",
            error: error.message,
            stack: error.stack,
        });
    }
}

/**
 * Middleware to verify that a user is authenticated.
 *
 * Place at the start of any route that requires an authenticated user.
 * Verifies the Authorization header, decodes the access token and attaches
 * user information to `req.user` for downstream handlers.
 */
async function isAuthenticated(req: LoggedRequest, res: Response, next: NextFunction): Promise<void> {
    // Check if an API key is provided
    const apiKeyHeader = req.headers.api || (req.query.api as string | undefined) || req.body.api;
    const apiKey = typeof apiKeyHeader === "string" ? apiKeyHeader.trim() : null;
    if (apiKey) {
        let apiUser: UserRow | undefined;

        // Fast path: check the in-memory cache to avoid bcrypt comparisons on repeat requests.
        const cachedEmail = apiKeyCacheStore.get(apiKey);
        if (cachedEmail) {
            apiUser = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [cachedEmail]);
        }

        // Slow path: cache miss — scan all users with an API key and bcrypt-compare each one.
        if (!apiUser) {
            const users = await dbGetAll<UserRow>("SELECT * FROM users WHERE API IS NOT NULL");
            for (const user of users) {
                if (!user.API) continue;
                const matches = await compare(apiKey, user.API);
                if (matches) {
                    apiUser = user;
                    apiKeyCacheStore.set(apiKey, user.email);
                    break;
                }
            }
        }

        if (!apiUser) {
            req.warnEvent("auth.invalid_api_key", "Invalid API key provided");
            throw new AuthError("Invalid API key provided.");
        }

        let user: UserState | undefined = classStateStore.getUser(apiUser.email);
        if (!user) {
            user = createStudentFromUserData(apiUser as unknown as Record<string, unknown>, { isGuest: false });
            classStateStore.setUser(apiUser.email, user);
        }

        (req as unknown as AuthenticatedRequest).user = {
            ...user!,
            email: apiUser.email,
            id: user!.id || apiUser.id,
            userId: user!.id || apiUser.id,
        } as AuthenticatedRequest["user"];

        next();
        return;
    }

    const authorizationHeader = req.headers.authorization;
    const accessToken = authorizationHeader ? authorizationHeader.replace(/^Bearer\s+/i, "") : null;
    if (!accessToken) {
        req.warnEvent("auth.missing_token", "User is not authenticated: No access token or API key provided");
        throw new AuthError("User is not authenticated");
    }

    const decodedToken = verifyToken(accessToken);
    if (decodedToken.error) {
        req.warnEvent("auth.invalid_token", "Invalid access token provided", { error: decodedToken.error });
        throw new AuthError("Invalid access token provided.");
    }

    const email = decodedToken.email;
    if (!email) {
        req.warnEvent("auth.missing_email", "Invalid access token provided: Missing 'email'");
        throw new AuthError("Invalid access token provided. Missing 'email'.");
    }

    const user: UserState | undefined = classStateStore.getUser(email);
    if (!user) {
        req.warnEvent("auth.user_not_found", `User not found in ClassStateStore: ${email}`, { email });
        throw new AuthError("User is not authenticated");
    }

    // Attach user data to req.user for stateless API authentication
    (req as unknown as AuthenticatedRequest).user = {
        ...user,
        email,
        userId: user.id,
    } as AuthenticatedRequest["user"];

    next();
}

// Check if the user's email is verified
async function isVerified(req: LoggedRequest, res: Response, next: NextFunction): Promise<void> {
    // Use req.user if available (set by isAuthenticated), otherwise decode from token
    const authReq = req as Partial<AuthenticatedRequest> & LoggedRequest;
    let email: string | undefined = authReq.user?.email;
    if (!email) {
        const accessToken = req.headers.authorization ? req.headers.authorization.replace("Bearer ", "") : null;
        if (!accessToken) {
            req.warnEvent("auth.not_authenticated", "User is not authenticated: No token found");
            throw new AuthError("User is not authenticated.");
        }

        const decodedToken = verifyToken(accessToken);
        if (!decodedToken.error && decodedToken.email) {
            email = decodedToken.email;
        }
    }

    if (!email) {
        req.warnEvent("auth.not_authenticated", "User is not authenticated: Could not determine email");
        throw new AuthError("User is not authenticated.");
    }

    const user: UserState | undefined = classStateStore.getUser(email);

    // If email verification is disabled, allow access.
    if (!settings.emailEnabled) {
        next();
        return;
    }

    // Guests bypass email verification.
    if (user && user.permissions == GUEST_PERMISSIONS) {
        next();
        return;
    }

    // Fast path from in-memory session state.
    if (user && user.verified) {
        next();
        return;
    }

    // Fallback to DB when in-memory state is stale or missing `verified`.
    const dbUser = await dbGet<{ verified: number }>("SELECT verified FROM users WHERE email = ?", [email]);
    if (dbUser && dbUser.verified) {
        if (user) {
            classStateStore.updateUser(email, { verified: 1 });
        }
        if (authReq.user) {
            authReq.user.verified = 1;
        }
        next();
        return;
    }

    req.warnEvent("auth.not_verified", `User email is not verified: ${email}`, { email });
    throw new AuthError("User email is not verified.");
}

module.exports = {
    cleanRefreshTokens,

    // Whitelisted/Blacklisted IP addresses
    whitelistedIps,
    blacklistedIps,

    // Authentication functions
    isAuthenticated,
    isVerified,
};
