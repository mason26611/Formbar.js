import fs = require("fs");
import crypto = require("crypto");
require("dotenv").config();

interface KeyPair {
    publicKey: string;
    privateKey: string;
}

interface Settings {
    port: number;
    whitelistActive: boolean;
    blacklistActive: boolean;
    emailEnabled: boolean;
    googleOauthEnabled: boolean;
    rateLimitWindowMs: number;
    rateLimitMultiplier: number;
}

interface RateLimitConfig {
    maxAttempts: number;
    lockoutDuration: number;
    attemptWindow: number;
    minDelayBetweenAttempts: number;
}

interface Config {
    settings: Settings;
    publicKey: string;
    privateKey: string;
    frontendUrl: string | undefined;
    rateLimit: RateLimitConfig;
}

/*
 * Generates a new RSA key pair and saves them to files.
 * Private and public keys are to be used to make Formbar OAuth more secure.
 * The private key is used to sign the data, and the public key is used to check the signature.
 * The public key is shared with the client, and the private key is kept secret on the server.
 * This way, users' applications can verify the JWT signature using the public key, while the server can sign the JWT with its private key.
 * This is a common practice in OAuth implementations to ensure secure communication between the client and server.
 * jack black
 */
function generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: "spki",
            format: "pem",
        },
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
        },
    });

    fs.writeFileSync("public-key.pem", publicKey);
    fs.writeFileSync("private-key.pem", privateKey);

    return {
        publicKey,
        privateKey,
    };
}

function getConfig(): Config {
    let publicKey: string;
    let privateKey: string;

    // If the public key is named publicKey.pem, rename it
    if (fs.existsSync("publicKey.pem") && !fs.existsSync("public-key.pem")) {
        fs.renameSync("publicKey.pem", "public-key.pem");
    }

    // If the private key is named privateKey.pem, rename it
    if (fs.existsSync("privateKey.pem") && !fs.existsSync("private-key.pem")) {
        fs.renameSync("privateKey.pem", "private-key.pem");
    }

    // If public-key.pem or private-key.pem doesn't exist, create them
    if (!fs.existsSync("public-key.pem") || !fs.existsSync("private-key.pem")) {
        const keyPair = generateKeyPair();
        publicKey = keyPair.publicKey;
        privateKey = keyPair.privateKey;
    } else {
        publicKey = fs.readFileSync("public-key.pem", "utf8");
        privateKey = fs.readFileSync("private-key.pem", "utf8");
    }

    // If there is no .env file, create one from the template
    if (!fs.existsSync(".env")) fs.copyFileSync(".env-template", ".env");

    return {
        settings: {
            port: +(process.env.PORT ?? 420) || 420,
            whitelistActive: process.env.WHITELIST_ENABLED === "true",
            blacklistActive: process.env.BLACKLIST_ENABLED === "true",
            emailEnabled: process.env.EMAIL_ENABLED === "true",
            googleOauthEnabled: process.env.GOOGLE_OAUTH_ENABLED === "true",

            // Sliding window length in milliseconds for rate limiting.
            rateLimitWindowMs: (() => {
                const secs = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "", 10);
                return Number.isFinite(secs) && secs >= 1 ? secs * 1000 : 60_000;
            })(),

            // Multiplier applied to all per-user request limits.
            rateLimitMultiplier: Math.max(0.1, parseFloat(process.env.RATE_LIMIT_MULTIPLIER ?? "1")) || 1,
        },
        publicKey: publicKey,
        privateKey: privateKey,
        frontendUrl: process.env.FRONTEND_URL,
        rateLimit: {
            maxAttempts: 5,
            lockoutDuration: 15 * 60 * 1000, // 15 minutes in milliseconds
            attemptWindow: 5 * 60 * 1000, // 5 minute sliding window
            minDelayBetweenAttempts: 500, // 500ms minimum delay
        },
    };
}

module.exports = getConfig();
export { Config, Settings, RateLimitConfig, KeyPair };
