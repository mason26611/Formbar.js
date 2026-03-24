import { Request, Response, NextFunction } from "express";
import { Logger } from "winston";

// Extended Express Request with authentication and logging
export interface AuthenticatedRequest extends Request {
    user: AuthenticatedUser;
    logger: Logger;
    logEvent: (level: string, event: string, message: string, metadata?: Record<string, unknown>) => void;
    infoEvent: (event: string, message: string, metadata?: Record<string, unknown>) => void;
    warnEvent: (event: string, message: string, metadata?: Record<string, unknown>) => void;
    errorEvent: (event: string, message: string, metadata?: Record<string, unknown>) => void;
}

export interface AuthenticatedUser {
    id: number;
    userId: number;
    email: string;
    displayName: string | null;
    permissions: number;
    role: string | null;
    verified: number;
    digipogs: number;
    tags: string | null;
    classId?: number;
    activeClass?: number;
    classPermissions?: number;
    classRole?: string;
    [key: string]: unknown;
}

export interface LoggedRequest extends Request {
    logger: Logger;
    logEvent: (level: string, event: string, message: string, metadata?: Record<string, unknown>) => void;
    infoEvent: (event: string, message: string, metadata?: Record<string, unknown>) => void;
    warnEvent: (event: string, message: string, metadata?: Record<string, unknown>) => void;
    errorEvent: (event: string, message: string, metadata?: Record<string, unknown>) => void;
}

export interface ApiResponse {
    success: boolean;
    error?: {
        message: string;
    };
    [key: string]: unknown;
}

export type ExpressMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
export type AsyncExpressMiddleware = (req: Request, res: Response, next: NextFunction) => Promise<void>;
export type ErrorMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => void | Promise<void>;

// Controller registration function type
export type ControllerRegistrar = (router: import("express").Router) => void;
