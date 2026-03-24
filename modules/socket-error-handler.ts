import type winston from "winston";
import type { Socket } from "socket.io";

const { getLogger, logEvent } = require("@modules/logger") as {
    getLogger: () => Promise<winston.Logger>;
    logEvent: (logger: winston.Logger, level: string, event: string, message: string, meta?: Record<string, unknown>) => void;
};

interface SocketWithSession extends Socket {
    request: Socket["request"] & {
        session?: {
            email?: string;
            userId?: number;
            [key: string]: unknown;
        };
    };
}

/**
 * Shared error handler for socket event handlers.
 * Logs the error using the production logger and emits an error message to the client.
 */
async function handleSocketError(err: Error | string, socket: SocketWithSession, event: string, customMessage?: string): Promise<void> {
    const logger = await getLogger();

    const errorMessage = err instanceof Error ? err.message : err;
    const stack = err instanceof Error ? err.stack : new Error().stack;

    logEvent(logger, "error", "socket.error", errorMessage, {
        event: event,
        stack: stack,
        socketId: socket.id,
        email: socket.request.session?.email,
        userId: socket.request.session?.userId,
    });

    socket.emit("error", {
        message: customMessage || "An internal server error occurred.",
        event: event,
    });
}

module.exports = {
    handleSocketError,
};
