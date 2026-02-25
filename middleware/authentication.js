const { getLogger } = require("@modules/logger");
const { classStateStore } = require("@services/classroom-service");
const { settings } = require("@modules/config");
const { GUEST_PERMISSIONS } = require("@modules/permissions");
const { dbGetAll, dbRun } = require("@modules/database");
const { verifyToken, cleanupExpiredAuthorizationCodes } = require("@services/auth-service");
const AuthError = require("@errors/auth-error");

const whitelistedIps = {};
const blacklistedIps = {};

// Removes expired refresh tokens and authorization codes from the database
async function cleanRefreshTokens() {
    try {
        const refreshTokens = await dbGetAll("SELECT * FROM refresh_tokens");
        for (const refreshToken of refreshTokens) {
            if (Date.now() >= refreshToken.exp) {
                await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ?", [refreshToken.token_hash]);
            }
        }
        // Also clean up expired authorization codes
        await cleanupExpiredAuthorizationCodes();
    } catch (err) {
        const logger = await getLogger();
        logger.error({
            event: "auth.cleanup.error",
            message: "Failed to clean up expired refresh tokens or authorization codes",
            error: err.message,
            stack: err.stack,
        });
    }
}

/**
 * Middleware to verify that a user is authenticated.
 *
 * Place at the start of any route that requires an authenticated user.
 * Verifies the Authorization header, decodes the access token and attaches
 * user information to `req.user` for downstream handlers.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function.
 * @throws {AuthError} When no token is provided, the token is invalid,
 *                     the token is missing an email, or the user is not found.
 * @returns {void}
 */
function isAuthenticated(req, res, next) {
    const accessToken = req.headers.authorization ? req.headers.authorization.replace("Bearer ", "") : null;
    if (!accessToken) {
        req.warnEvent(req, "auth.missing_token", "User is not authenticated: No access token provided");
        throw new AuthError("User is not authenticated");
    }

    const decodedToken = verifyToken(accessToken);
    if (decodedToken.error) {
        req.warnEvent(req, "auth.invalid_token", "Invalid access token provided", { error: decodedToken.error });
        throw new AuthError("Invalid access token provided.");
    }

    const email = decodedToken.email;
    if (!email) {
        req.warnEvent(req, "auth.missing_email", "Invalid access token provided: Missing 'email'");
        throw new AuthError("Invalid access token provided. Missing 'email'.");
    }

    const user = classStateStore.getUser(email);
    if (!user) {
        req.warnEvent(req, "auth.user_not_found", `User not found in ClassStateStore: ${email}`, { email });
        throw new AuthError("User is not authenticated");
    }

    // Attach user data to req.user for stateless API authentication
    req.user = {
        email: email,
        ...user,
        userId: user.id,
    };

    next();
}

// Create a function to check if the user's email is verified
function isVerified(req, res, next) {
    // Use req.user if available (set by isAuthenticated), otherwise decode from token
    let email = req.user?.email;
    if (!email) {
        const accessToken = req.headers.authorization ? req.headers.authorization.replace("Bearer ", "") : null;
        if (!accessToken) {
            req.warnEvent(req, "auth.not_authenticated", "User is not authenticated: No token found");
            throw new AuthError("User is not authenticated.");
        }

        const decodedToken = verifyToken(accessToken);
        if (!decodedToken.error && decodedToken.email) {
            email = decodedToken.email;
        }
    }

    if (!email) {
        req.warnEvent(req, "auth.not_authenticated", "User is not authenticated: Could not determine email");
        throw new AuthError("User is not authenticated.");
    }

    const user = classStateStore.getUser(email);
    // If the user is verified or email functionality is disabled...
    if ((user && user.verified) || !settings.emailEnabled || (user && user.permissions == GUEST_PERMISSIONS)) {
        next();
    } else {
        req.warnEvent(req, "auth.not_verified", `User email is not verified: ${email}`, { email });
        throw new AuthError("User email is not verified.");
    }
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
