import type { Response, NextFunction } from "express";
import type { LoggedRequest } from "../types/api";

const { getUser } = require("@services/user-service.js") as {
    getUser: (identifier: { email?: string; api?: string | string[] }) => Promise<RateLimitUser | null>;
};
const { verifyToken } = require("@services/auth-service.js") as {
    verifyToken: (token: string) => DecodedToken;
};
const { TEACHER_PERMISSIONS, GUEST_PERMISSIONS } = require("@modules/permissions.js") as {
    TEACHER_PERMISSIONS: number;
    GUEST_PERMISSIONS: number;
};
const { settings } = require("@modules/config.js") as {
    settings: { rateLimitWindowMs?: number; rateLimitMultiplier?: number };
};

interface RateLimitUser {
    email: string;
    permissions: number;
    error?: string;
}

interface DecodedToken {
    email?: string;
    error?: string;
    [key: string]: unknown;
}

// In-memory rate limit storage
// Structure: { identifier: { path: [timestamps], hasBeenMessaged: bool } }
const rateLimits: Record<string, Record<string, number[] | boolean>> = {};

async function rateLimiter(req: LoggedRequest, res: Response, next: NextFunction): Promise<void> {
    let user: RateLimitUser | null = null;
    if (req.headers.api) {
        user = await getUser({ api: req.headers.api });
    } else if (req.headers.authorization) {
        const decodedToken: DecodedToken = verifyToken(req.headers.authorization);
        if (!decodedToken || decodedToken.error || !decodedToken.email) {
            user = { email: req.ip || "unknown", permissions: GUEST_PERMISSIONS };
        } else {
            const email = decodedToken.email;
            user = await getUser({ email });
        }
    } else {
        // If no auth provided, use ip as identifier with guest permissions
        user = { email: req.ip || "unknown", permissions: GUEST_PERMISSIONS };
    }

    // Fallback for invalid user data
    if (!user || user.error || !user.email || !user.permissions) {
        user = { email: req.ip || "unknown", permissions: GUEST_PERMISSIONS };
    }

    const identifier = user.email;
    const currentTime = Date.now();
    const timeFrame: number = settings.rateLimitWindowMs ?? 60000;
    let limit = 10; // Default limit for unauthenticated users
    if (user.permissions >= TEACHER_PERMISSIONS) {
        limit = 225;
    } else if (user.permissions > GUEST_PERMISSIONS) {
        limit = req.path.startsWith("/auth/") ? 10 : 120;
    }
    // Apply the configurable multiplier so test runs can relax limits.
    limit = Math.max(1, Math.round(limit * (settings.rateLimitMultiplier ?? 1)));

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

    const pathTimestamps = userRequests[path] as number[];

    // Remove timestamps that are outside the time frame
    while (pathTimestamps.length && currentTime - pathTimestamps[0] > timeFrame) {
        pathTimestamps.shift();
        userRequests["hasBeenMessaged"] = false;
    }

    // Check if the user has exceeded the limit
    if (pathTimestamps.length >= limit) {
        if (!userRequests["hasBeenMessaged"]) {
            userRequests["hasBeenMessaged"] = true;
            req.warnEvent("rate_limit.exceeded", `Rate limit exceeded for user ${identifier} on path ${path}`, {
                identifier,
                path,
                limit,
                permissions: user.permissions,
            });
        }

        // Always respond while over-limit; otherwise the request hangs forever.
        res.status(429).json({ error: `You are being rate limited. Please try again in ${timeFrame / 1000} seconds.` });
        return;
    }

    pathTimestamps.push(currentTime);
    next();
}

module.exports = {
    rateLimiter,
};
