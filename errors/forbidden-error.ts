import { AppErrorOptions } from "./app-error";

const AppError = require("./app-error");

class ForbiddenError extends AppError {
    constructor(message: string, options: AppErrorOptions = {}) {
        super(message, { statusCode: 403, ...options });
    }
}

module.exports = ForbiddenError;
