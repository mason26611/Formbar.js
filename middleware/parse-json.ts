import type { Request, Response, NextFunction } from "express";

/**
 * This middleware will go through the body of a request and check if something can be parsed to JSON.
 * If it can be, it will automatically be parsed.
 */
function parseJson(req: Request, res: Response, next: NextFunction): void {
    for (const dataName in req.body) {
        try {
            req.body[dataName] = JSON.parse(req.body[dataName]);
        } catch (_err) {} // Don't do anything in the case of failure
    }
    next();
}

module.exports = { parseJson };
