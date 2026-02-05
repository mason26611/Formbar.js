const { getUser } = require("../user/user");
const { logger } = require("../logger");
const { TEACHER_PERMISSIONS, GUEST_PERMISSIONS } = require("../permissions");
const { compare } = require("../crypto");
const { database } = require("../database");

// In-memory rate limit storage
// Structure: { identifier: { path: [timestamps], hasBeenMessaged: bool } }
const rateLimits = {};

/**
 * Rate limiter middleware for HTTP requests
 * Limits requests per user per endpoint within a time frame
 */
async function rateLimiter(req, res, next) {
    try {
        let user = null;
        let identifier = req.ip; // Default to IP address

        // Try to get user from API key in headers or body
        const apiKey = req.headers.api || req.body?.api;
        if (apiKey) {
            user = await getUser({ api: apiKey });
            
            // If user lookup failed or returned an error, treat as guest
            if (!user || user instanceof Error || user.error) {
                user = { email: req.ip, permissions: GUEST_PERMISSIONS };
            } else {
                identifier = user.email;
            }
        } 
        // Try to get user from session
        else if (req.session && req.session.email) {
            user = await getUser({ email: req.session.email });
            
            // If user lookup failed or returned an error, treat as guest
            if (!user || user instanceof Error || user.error) {
                user = { email: req.ip, permissions: GUEST_PERMISSIONS };
            } else {
                identifier = user.email;
            }
        } 
        // No authentication provided - use IP as identifier
        else {
            user = { email: req.ip, permissions: GUEST_PERMISSIONS };
        }

        // Fallback for invalid user data
        if (!user || !user.email || user.permissions === undefined) {
            user = { email: req.ip, permissions: GUEST_PERMISSIONS };
            identifier = req.ip;
        }

        const currentTime = Date.now();
        const timeFrame = 60000; // 1 minute
        let limit = 10; // Default limit for unauthenticated users

        // Set limits based on user permissions
        if (user.permissions >= TEACHER_PERMISSIONS) {
            limit = 225;
        } else if (user.permissions > GUEST_PERMISSIONS) {
            // Lower limit for auth endpoints to prevent brute force
            limit = req.path.startsWith("/auth/") ? 10 : 120;
        }

        // Initialize rate limit log for the identifier if it doesn't exist
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
        if (userRequests[path].length >= limit) {
            if (!userRequests["hasBeenMessaged"]) {
                userRequests["hasBeenMessaged"] = true;
                logger.log("info", `[rateLimiter] Rate limit exceeded for identifier=(${identifier}) path=(${path})`);
                return res.status(429).json({ 
                    error: `You are being rate limited. Please try again in ${timeFrame / 1000} seconds.` 
                });
            }
            // If already messaged, silently reject
            return res.status(429).json({ 
                error: `You are being rate limited. Please try again in ${timeFrame / 1000} seconds.` 
            });
        } else {
            // Log the request and proceed
            userRequests[path].push(currentTime);
            next();
        }
    } catch (err) {
        // Log error but don't block the request
        logger.log("error", `[rateLimiter] Error: ${err.stack}`);
        next();
    }
}

module.exports = {
    rateLimiter,
    rateLimits, // Export for testing purposes
};
