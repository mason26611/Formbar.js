import { AppErrorOptions } from "./app-error";

const AppError = require("./app-error");

class NotFoundError extends AppError {
    constructor(message: string, options: AppErrorOptions = {}) {
        super(message, { statusCode: 404, ...options });
    }
}

module.exports = NotFoundError;
