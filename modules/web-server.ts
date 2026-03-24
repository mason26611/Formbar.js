import express = require("express");
import swaggerUi = require("swagger-ui-express");
import swaggerJsdoc = require("swagger-jsdoc");
import cors = require("cors");
import http = require("http");
import { Server as SocketIOServer } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from "../types/socket";

interface SwaggerTag {
    name: string;
    description: string;
    "x-order": number;
}

function createServer(): { app: express.Application; io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>; http: http.Server } {
    const app = express();
    const httpServer = http.createServer(app);
    const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
        cors: {
            origin: "*",
        },
    });

    // Enables CORS if not using nginx or if ENABLE_CORS is set to true.
    if (process.env.ENABLE_CORS === "true") {
        app.use(cors({ origin: "*" }));
    }

    const swaggerDocOptions: swaggerJsdoc.Options = {
        definition: {
            openapi: "3.0.0",
            info: {
                title: "Formbar API",
                version: "3.0.0",
                description: "HTTP API documentation for Formbar.js.",
            },
            tags: [
                { name: "Authentication", description: "User authentication and registration", "x-order": 1 },
                { name: "System", description: "System utilities and certificates", "x-order": 2 },
                { name: "Users", description: "User management and profile operations", "x-order": 3 },
                { name: "Class", description: "Class creation and basic operations", "x-order": 4 },
                { name: "Class - Polls", description: "Polling system within classes", "x-order": 5 },
                { name: "Class - Breaks", description: "Break request system", "x-order": 6 },
                { name: "Class - Help", description: "Help ticket system", "x-order": 7 },
                { name: "Room", description: "Room joining and configuration", "x-order": 8 },
                { name: "Room - Links", description: "Link management for rooms", "x-order": 9 },
                { name: "Digipogs", description: "Virtual currency management", "x-order": 10 },
                { name: "IP Management", description: "IP whitelist/blacklist management", "x-order": 11 },
                { name: "Manager", description: "Manager/admin functions", "x-order": 12 },
                { name: "Notifications", description: "User notification management", "x-order": 13 },
                { name: "OAuth", description: "OAuth 2.0 authorization flow", "x-order": 14 },
                { name: "Apps", description: "Application registration and management", "x-order": 15 },
                { name: "Pools", description: "Digipog pool management", "x-order": 16 },
            ] as SwaggerTag[],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT",
                        description: "JWT access token obtained from /api/v1/auth/login or /api/v1/auth/refresh",
                    },
                    apiKeyAuth: {
                        type: "apiKey",
                        in: "header",
                        name: "X-API-Key",
                        description: "API key associated with your account. Can be retrieved from your user profile.",
                    },
                },
                "x-formbar": {
                    nodeEnv: process.env.NODE_ENV || "production",
                },
            },
        },
        apis: ["./api/v1/**/*.js", "./docs/components/**/*.yaml"],
    };

    const specs = swaggerJsdoc(swaggerDocOptions) as { paths?: Record<string, unknown> };

    // Sort paths by length (shorter first) before passing to Swagger UI
    if (specs.paths) {
        const sortedPaths: Record<string, unknown> = {};
        Object.keys(specs.paths)
            .sort((a, b) => {
                const segmentsA = a.split("/").length;
                const segmentsB = b.split("/").length;

                if (segmentsA !== segmentsB) {
                    return segmentsA - segmentsB;
                }

                return a.localeCompare(b);
            })
            .forEach((key) => {
                sortedPaths[key] = specs.paths![key];
            });
        specs.paths = sortedPaths;
    }

    app.get(["/docs.json", "/docs/openapi.json"], (_req: express.Request, res: express.Response) => {
        res.json(specs);
    });

    app.use(
        "/docs",
        swaggerUi.serve,
        swaggerUi.setup(specs, {
            swaggerOptions: {
                operationsSorter: "method",
            },
        })
    );

    return { app, io, http: httpServer };
}

const { app, io, http: httpInstance } = createServer();
module.exports = {
    app,
    io,
    http: httpInstance,
};
