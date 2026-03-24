// Support module aliases for importing
require("module-alias/register");

import sqlite3 = require("sqlite3");
import fs = require("fs");

const { decrypt } = require("./modules/crypto") as { decrypt: (hash: { iv: string; content: string }) => string };
const { hash } = require("@modules/crypto") as { hash: (text: string) => Promise<string> };

interface MigrationEntry {
    type: "sql" | "js";
    filename: string;
    path: string;
}

interface PragmaColumnInfo {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}

interface LegacyUserRow {
    id: number;
    email?: string;
    password: string;
}

// Get all migration files and sort them by filename
const sqlMigrations: MigrationEntry[] = fs
    .readdirSync("./database/migrations")
    .filter((file: string) => file.endsWith(".sql"))
    .map((file: string) => ({
        type: "sql" as const,
        filename: file,
        path: `./database/migrations/${file}`,
    }));

if (!fs.existsSync("./database/migrations/JSMigrations")) {
    fs.mkdirSync("./database/migrations/JSMigrations");
}

const jsMigrations: MigrationEntry[] = fs
    .readdirSync("./database/migrations/JSMigrations")
    .filter((file: string) => file.endsWith(".js") || file.endsWith(".ts"))
    .map((file: string) => ({
        type: "js" as const,
        filename: file,
        path: `./migrations/JSMigrations/${file}`,
    }));

// Combine and sort all migrations
const allMigrations: MigrationEntry[] = [...sqlMigrations, ...jsMigrations].sort((a, b) => a.filename.localeCompare(b.filename));

// Backup the database if there's already a database, unless the SKIP_BACKUP flag is set
// If there's already a backup, denote it with a number
if (fs.existsSync("database/database.db") && !process.env.SKIP_BACKUP) {
    let backupNumber = fs.existsSync("database/database.bak") ? 1 : 0;
    while (fs.existsSync(`database/database-${backupNumber}.bak`)) {
        backupNumber++;
    }

    const backupPath = backupNumber == 0 ? "database/database.bak" : `database/database-${backupNumber}.bak`;
    fs.copyFileSync("database/database.db", backupPath);
}

const verbose = sqlite3.verbose();

// Retrieve the database
const database = new verbose.Database("./database/database.db");

// Run migrations in sequence
async function executeMigration(index: number): Promise<void> {
    // When there are no more migrations, close the database
    if (index >= allMigrations.length) {
        database.close();
        return;
    }

    const migration = allMigrations[index];
    console.log(`Running ${migration.type.toUpperCase()} migration: ${migration.filename}`);

    try {
        if (migration.type === "sql") {
            await executeSQLMigration(migration);
        } else {
            await executeJSMigration(migration);
        }

        console.log(`Completed ${migration.type.toUpperCase()} migration: ${migration.filename}`);
        await executeMigration(index + 1);
    } catch (err) {
        console.error(`Error executing ${migration.type.toUpperCase()} migration ${migration.filename}:`, err);
        database.close();
        process.exit(1);
    }
}

// Execute a single SQL migration
async function executeSQLMigration(migration: MigrationEntry): Promise<void> {
    const migrationSQL = fs.readFileSync(migration.path, "utf8");

    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run("BEGIN TRANSACTION");

            database.exec(migrationSQL, (err: Error | null) => {
                if (err) {
                    database.run("ROLLBACK");

                    // If --verbose flag is set, log the error
                    if (process.argv.includes("verbose")) {
                        console.error(err);
                    }

                    console.log(
                        "Unable to complete migration as this migration has already been run, or an error has occurred. Continuing to next migration."
                    );
                    resolve();
                } else {
                    database.run("COMMIT", (err: Error | null) => {
                        if (err) {
                            database.run("ROLLBACK");
                            reject(err);
                        }

                        // Special handling for migration 01 (password conversion)
                        if (migration.filename.startsWith("01")) {
                            database.all("SELECT * FROM users", async (err: Error | null, users: LegacyUserRow[]) => {
                                if (err) {
                                    console.error(err);
                                    return;
                                }

                                for (const user of users) {
                                    if (user.email !== undefined) continue;
                                    const decryptedPassword = decrypt(JSON.parse(user.password));
                                    const hashedPassword = await hash(decryptedPassword);
                                    database.run("UPDATE users SET password=? WHERE id=?", [hashedPassword, user.id]);
                                }
                            });
                        }

                        resolve();
                    });
                }
            });
        });
    });
}

// Execute a single JS migration
async function executeJSMigration(migration: MigrationEntry): Promise<void> {
    try {
        const migrationModule = require(migration.path) as { run: (db: sqlite3.Database) => Promise<void> };
        await migrationModule.run(database);
    } catch (err) {
        if ((err as Error).message === "ALREADY_DONE") {
            console.log("Unable to complete migration as this migration has already been run. Continuing to next migration.");
            return;
        }

        // Rollback the transaction if there was an error
        database.run("ROLLBACK");
        console.error(`Error executing JS migration ${migration.filename}:`, err);
        throw err;
    }
}

// Begin migrations
executeMigration(0);
