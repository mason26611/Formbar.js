import { AppErrorOptions } from "./app-error";

const AppError = require("./app-error");

class ValidationError extends AppError {
    constructor(message: string, options: AppErrorOptions = {}) {
        super(message, { statusCode: 400, ...options });
    }
}

module.exports = ValidationError;
