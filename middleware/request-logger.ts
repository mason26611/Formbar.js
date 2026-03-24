import type { Request, Response, NextFunction } from "express";
import type { Logger } from "winston";
import type { LoggedRequest } from "../types/api";

const { getLogger, logEvent } = require("@modules/logger.js") as {
    getLogger: () => Promise<Logger>;
    logEvent: (logger: Logger, level: string, event: string, message: string, meta?: Record<string, unknown>) => void;
};
const crypto = require("crypto");

interface RequestBaseMeta {
    requestId: string;
    method: string;
    path: string;
    ip: string | undefined;
    userId?: number;
    email?: string;
    displayName?: string | null;
}

// Middleware to log incoming requests and their completion time
async function requestLogger(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Attach a child logger to the request with relevant metadata
    const baseMeta: RequestBaseMeta = {
        requestId: crypto.randomUUID(),
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
    };

    // Add user info if available
    const partialReq = req as Partial<LoggedRequest> & { user?: { id?: number; email?: string; displayName?: string | null } };
    if (partialReq.user && partialReq.user.id) {
        baseMeta.userId = partialReq.user.id;
        baseMeta.email = partialReq.user.email;
        baseMeta.displayName = partialReq.user.displayName;
    }

    // adds metadata to every log under this request
    const logger: Logger = await getLogger();
    const loggedReq = req as LoggedRequest;
    loggedReq.logger = logger.child(baseMeta);

    // helpers to log events with the request's logger
    loggedReq.logEvent = logEvent.bind(null, loggedReq.logger);
    loggedReq.infoEvent = loggedReq.logEvent.bind(null, "info");
    loggedReq.warnEvent = loggedReq.logEvent.bind(null, "warn");
    loggedReq.errorEvent = loggedReq.logEvent.bind(null, "error");

    const start = process.hrtime.bigint();

    // set listener for when response finishes
    res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        loggedReq.infoEvent("request.complete", "Request Complete", {
            statusCode: res.statusCode,
            duration: durationMs,
        });
    });

    next();
}

module.exports = requestLogger;
