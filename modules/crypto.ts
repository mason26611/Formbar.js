import bcrypt = require("bcrypt");
import crypto = require("crypto");

// Increases time to log in/verify
const saltRounds: number = parseInt(process.env.SALT_ROUNDS ?? "", 10) || 10;

/**
 * Generates a hash for the given text using bcrypt with a specified number of salt rounds.
 */
function hash(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (typeof text !== "string") {
            reject(new Error("Text to hash must be a string"));
            return;
        }

        if (!text) {
            reject(new Error("Text to hash must be provided"));
            return;
        }

        bcrypt.genSalt(saltRounds, (err, salt) => {
            if (err) {
                reject(err);
                return;
            }

            bcrypt.hash(text, salt, (err, hash) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(hash);
            });
        });
    });
}

/**
 * Compares a given text with a hash to check if they match.
 */
function compare(text: string, hash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        if (typeof text !== "string" || typeof hash !== "string") {
            reject(new Error("Both text and hash must be strings"));
            return;
        }

        if (!text || !hash) {
            reject(new Error("Both text and hash must be provided"));
            return;
        }

        bcrypt.compare(text, hash, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(res);
        });
    });
}

/**
 * Generates a SHA-256 hex digest for the provided input string.
 */
function sha256(input: string): string {
    if (typeof input !== "string") {
        throw new Error("Input to sha256 must be a string");
    }

    if (input.length === 0) {
        throw new Error("Input to sha256 must not be empty");
    }

    return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = {
    hash,
    compare,
    sha256,
};
