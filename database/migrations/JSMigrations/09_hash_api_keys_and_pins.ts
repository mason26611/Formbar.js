// 09_hash_api_keys_and_pins.ts
// This migration hashes all existing API keys and PINs in the users table

import sqlite3 = require("sqlite3");

const { hash } = require("@modules/crypto") as { hash: (text: string) => Promise<string> };
const { dbGet, dbRun, dbGetAll } = require("@modules/database") as {
    dbGet: <T>(query: string, params?: unknown[], db?: sqlite3.Database) => Promise<T | undefined>;
    dbRun: (query: string, params?: unknown[], db?: sqlite3.Database) => Promise<number>;
    dbGetAll: <T>(query: string, params?: unknown[], db?: sqlite3.Database) => Promise<T[]>;
};

interface UserVersionRow {
    user_version: number;
}

interface LegacyUserRow {
    id: number;
    email: string;
    password: string | null;
    permissions: number;
    API: string;
    secret: string;
    digipogs: number;
    pin: string | number | null;
    displayName: string | null;
    verified: number;
}

module.exports = {
    async run(database: sqlite3.Database): Promise<void> {
        // Check if we've already migrated by checking the user_version
        const versionRow = await dbGet<UserVersionRow>("PRAGMA user_version");
        const version = versionRow?.user_version ?? 0;
        if (version === 0) {
            await dbRun("PRAGMA user_version = 1");
        } else {
            throw new Error("ALREADY_DONE"); // Migration already completed
        }

        // Get all users with their current API keys and PINs
        const users = await dbGetAll<LegacyUserRow>("SELECT * FROM users", [], database);

        // Create a new users table with hashed columns and pin as TEXT
        await dbRun(
            `CREATE TABLE IF NOT EXISTS users_temp (
                id INTEGER NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password TEXT,
                permissions INTEGER,
                API TEXT NOT NULL UNIQUE,
                secret TEXT NOT NULL UNIQUE,
                digipogs INTEGER NOT NULL DEFAULT 0,
                pin TEXT,
                displayName TEXT,
                verified INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (id AUTOINCREMENT)
            )`,
            []
        );

        // Hash and migrate each user's data
        for (const user of users) {
            // Hash the API key
            const hashedAPI = await hash(user.API);

            // Hash the PIN if it exists
            let hashedPin: string | null = null;
            if (user.pin) {
                hashedPin = await hash(user.pin.toString());
            }

            // Insert the user into the new table with hashed values
            await dbRun(
                `INSERT INTO users_temp (id, email, password, permissions, API, secret, digipogs, pin, displayName, verified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user.id,
                    user.email,
                    user.password,
                    user.permissions,
                    hashedAPI,
                    user.secret,
                    user.digipogs,
                    hashedPin,
                    user.displayName,
                    user.verified,
                ]
            );
        }

        // Drop old table and rename new one
        await dbRun("DROP TABLE users", []);
        await dbRun("ALTER TABLE users_temp RENAME TO users", []);

        console.log(`Successfully hashed API keys and PINs for ${users.length} users`);
    },
};
