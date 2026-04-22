const { getUser } = require("@services/user-service");
const { verifyToken } = require("@services/auth-service");
const { settings } = require("@modules/config");
const { computeGlobalPermissionLevel, STUDENT_PERMISSIONS, TEACHER_PERMISSIONS } = require("@modules/permissions");
const { getUserScopes } = require("@modules/scope-resolver");

// In-memory rate limit storage
// Structure: { identifier: { path: [timestamps], hasBeenMessaged: bool } }
const rateLimits = {};

const TIMED_RATE_LIMIT_WINDOW_MS = 60000;
const UNAUTHENTICATED_USER_RATE_LIMIT = 25;
const AUTHENTICATED_USER_RATE_LIMIT = 120;
const AUTHENTICATED_USER_RATE_LIMIT_FOR_AUTH_PATHS = 25;
const TEACHER_RATE_LIMIT = 225;

async function rateLimiter(req, res, next) {
    let user = null;
    if (req.headers.api) {
        user = await getUser({ api: req.headers.api });
    } else if (req.headers.authorization) {
        const decodedToken = verifyToken(req.headers.authorization);
        if (!decodedToken || decodedToken.error || !decodedToken.email) {
            user = { email: req.ip };
        } else {
            let email = decodedToken.email;
            user = await getUser({ email: email });
        }
    } else {
        user = { email: req.ip };
    }

    // Fallback for invalid user data
    if (!user || user.error || !user.email) {
        user = { email: req.ip };
    }

    const identifier = user.email;
    const currentTime = Date.now();
    const timeFrame = settings.rateLimitWindowMs ?? TIMED_RATE_LIMIT_WINDOW_MS;
    const permissionLevel = computeGlobalPermissionLevel(getUserScopes(user).global);
    
    let maximumRequests = UNAUTHENTICATED_USER_RATE_LIMIT; // Default limit for unauthenticated users
    if (permissionLevel >= TEACHER_PERMISSIONS) {
        maximumRequests = TEACHER_RATE_LIMIT;
    } else if (permissionLevel >= STUDENT_PERMISSIONS) {
        maximumRequests = req.path.startsWith("/auth/") ? AUTHENTICATED_USER_RATE_LIMIT_FOR_AUTH_PATHS : AUTHENTICATED_USER_RATE_LIMIT;
    }

    // Apply the configurable multiplier so test runs can relax limits.
    maximumRequests = Math.max(1, Math.round(maximumRequests * (settings.rateLimitMultiplier ?? 1)));

    // Initialize rate limit log for the user if it doesn't exist
    if (!rateLimits[identifier]) {
        rateLimits[identifier] = {};
    }

    // Get the user's request log
    const userRequests = rateLimits[identifier];
    const path = req.path;

    // Initialize request array for this path if it doesn't exist
    if (!userRequests[path]) {
        userRequests[path] = [];
    }

    // Remove timestamps that are outside the time frame
    while (userRequests[path].length && currentTime - userRequests[path][0] > timeFrame) {
        userRequests[path].shift();
        userRequests["hasBeenMessaged"] = false;
    }

    // Check if the user has exceeded the limit
    // If they have, send a rate limit response
    // Otherwise, log the request and proceed
    if (userRequests[path].length >= maximumRequests) {
        if (!userRequests["hasBeenMessaged"]) {
            userRequests["hasBeenMessaged"] = true;
            req.warnEvent("rate_limit.exceeded", `Rate limit exceeded for user ${identifier} on path ${path}`, {
                identifier,
                path,
                limit: maximumRequests,
                permissionLevel,
            });
        }

        // Always respond while over-limit; otherwise the request hangs forever.
        return res.status(429).json({ error: `You are being rate limited. Please try again in ${timeFrame / 1000} seconds.` });
    }

    userRequests[path].push(currentTime);
    next();
}

module.exports = {
    rateLimiter,
};
