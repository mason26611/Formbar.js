interface AppErrorOptions {
    statusCode?: number;
    event?: string;
    reason?: string;
    [key: string]: unknown;
}

class AppError extends Error {
    statusCode: number;
    isOperational: boolean;
    event?: string;
    reason?: string;
    [key: string]: unknown;

    constructor(
        message: string,
        options: AppErrorOptions = {
            statusCode: 500,
            event: "",
            reason: "",
        }
    ) {
        super(message);

        this.statusCode = options.statusCode ?? 500;
        this.isOperational = true;

        Object.assign(this, options);

        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;
export { AppError, AppErrorOptions };
