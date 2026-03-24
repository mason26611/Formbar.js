import type { Request, Response, NextFunction } from "express";
import type { LoggedRequest, ApiResponse } from "../types/api";
import type { Logger } from "winston";

const AppError = require("@errors/app-error.js") as new (message: string, options?: Record<string, unknown>) => OperationalError;
const { getLogger, logEvent } = require("@modules/logger.js") as {
    getLogger: () => Promise<Logger>;
    logEvent: (logger: Logger, level: string, event: string, message: string, meta?: Record<string, unknown>) => void;
};
const process = require("process");

interface OperationalError extends Error {
    statusCode?: number;
    status?: number;
    isOperational?: boolean;
    event?: string;
}

interface ParseError extends SyntaxError {
    status?: number;
    statusCode?: number;
    type?: string;
}

function isRequestParseError(err: unknown): err is ParseError {
    return (
        err instanceof SyntaxError &&
        ((err as ParseError).status === 400 || (err as ParseError).statusCode === 400) &&
        (err as ParseError).type === "entity.parse.failed"
    );
}

const errorHandler = async (
    err: OperationalError,
    req: Request,
    res: Response,
    _next: NextFunction,
): Promise<void> => {
    const logger = await getLogger();

    let error: Error = err;
    let statusCode: number = err.statusCode || err.status || 500;

    const isAppError = err instanceof AppError;
    const isOperationalError = (isAppError && err.isOperational) || isRequestParseError(err);

    const loggedReq = req as Partial<LoggedRequest>;

    // is error a crash
    if (!isOperationalError) {
        if (loggedReq.errorEvent) {
            loggedReq.errorEvent("request.crash", error.message, { error: error.message, stack: error.stack });
        } else {
            logEvent(logger, "error", "request.crash", error.message, { error: error.message, stack: error.stack });
        }

        if (process.env.NODE_ENV !== "production") {
            console.error(error);
        }

        statusCode = 500;
        error = new AppError("An unexpected error occurred.", { statusCode });

    // is error expected operational error
    } else {
        const event: string = err.event || (isRequestParseError(err) ? "request.parse.failed" : "request.error");
        if (loggedReq.warnEvent) {
            loggedReq.warnEvent(event, err.message, { error: err.message, stack: err.stack });
        } else {
            logEvent(logger, "warn", event, err.message, { error: err.message, stack: err.stack });
        }
    }

    const response: ApiResponse = {
        success: false,
        error: {
            message: error.message,
        },
    };

    res.status(statusCode).json(response);
};

module.exports = errorHandler;
