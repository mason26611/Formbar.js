import { AppErrorOptions } from "./app-error";

const AppError = require("./app-error");

class AuthError extends AppError {
    constructor(message: string, options: AppErrorOptions = {}) {
        super(message, { statusCode: 401, ...options });
    }
}

module.exports = AuthError;
