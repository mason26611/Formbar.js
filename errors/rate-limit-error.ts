import { AppErrorOptions } from "./app-error";

const AppError = require("./app-error");

class RateLimitError extends AppError {
    constructor(message: string, options: AppErrorOptions = {}) {
        super(message, { statusCode: 429, ...options });
    }
}

module.exports = RateLimitError;
