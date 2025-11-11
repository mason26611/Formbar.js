const sqlite3 = require("sqlite3");
const fs = require("fs");
const path = require("path");

/**
 * Creates an in-memory SQLite database for testing
 * @returns {Promise<sqlite3.Database>}
 */
function createTestDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(":memory:", (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(db);
            }
        });
    });
}

/**
 * Initializes a test database with the schema from init.sql
 * @param {sqlite3.Database} db - The database instance
 * @returns {Promise<void>}
 */
async function initializeTestDatabaseSchema(db) {
    const initSqlPath = path.join(__dirname, "../../database/init.sql");
    const schema = fs.readFileSync(initSqlPath, "utf8");

    // Split by semicolons and execute each statement
    // Handle multi-line statements and comments properly
    const statements = schema
        .split(";")
        .map((stmt) => stmt.trim())
        .filter((stmt) => {
            // Filter out empty statements and comments
            return stmt.length > 0 && !stmt.startsWith("--") && !stmt.match(/^\/\*/);
        });

    for (const statement of statements) {
        await new Promise((resolve, reject) => {
            db.run(statement, (err) => {
                if (err) {
                    // Some statements might fail (like IF NOT EXISTS), which is okay
                    // Only reject on actual errors
                    if (!err.message.includes("already exists") && !err.message.includes("duplicate column")) {
                        // Log the error for debugging but don't fail on expected errors
                        console.warn(`Schema initialization warning: ${err.message}`);
                        console.warn(`Statement: ${statement.substring(0, 100)}...`);
                    }
                    resolve(); // Continue even on expected errors
                } else {
                    resolve();
                }
            });
        });
    }

    // After migrations, the classroom table doesn't have permissions column
    // We need to recreate it without permissions (migration 05_class_permissions_table.sql)
    // First, drop the old classroom table if it exists
    await new Promise((resolve, reject) => {
        db.run("DROP TABLE IF EXISTS classroom", (err) => {
            if (err && !err.message.includes("no such table")) {
                reject(err);
            } else {
                resolve();
            }
        });
    });

    // Create classroom table without permissions column (as per migration)
    await new Promise((resolve, reject) => {
        db.run(
            `CREATE TABLE IF NOT EXISTS "classroom" (
                "id"	        INTEGER NOT NULL UNIQUE,
                "name"	        TEXT NOT NULL,
                "owner"	        INTEGER NOT NULL,
                "key"	        INTEGER NOT NULL,
                "tags"	        TEXT,
                "settings"	    TEXT,
                PRIMARY KEY("id" AUTOINCREMENT)
            )`,
            (err) => {
                if (err && !err.message.includes("already exists")) {
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });

    // Create class_permissions table (from migration 05_class_permissions_table.sql)
    // This table is needed for tests but is created in a migration, not init.sql
    await new Promise((resolve, reject) => {
        db.run(
            `CREATE TABLE IF NOT EXISTS "class_permissions" (
                "classId"	        INTEGER NOT NULL UNIQUE,
                "manageClass"	    INTEGER NOT NULL DEFAULT 4,
                "manageStudents"	INTEGER NOT NULL DEFAULT 4,
                "controlPoll"	    INTEGER NOT NULL DEFAULT 3,
                "votePoll"	        INTEGER NOT NULL DEFAULT 2,
                "seePoll"	        INTEGER NOT NULL DEFAULT 1,
                "breakHelp"	        INTEGER NOT NULL DEFAULT 3,
                "auxiliary"	        INTEGER NOT NULL DEFAULT 3,
                "links"	            INTEGER NOT NULL DEFAULT 3,
                "userDefaults"	    INTEGER NOT NULL DEFAULT 1
            )`,
            (err) => {
                if (err && !err.message.includes("already exists")) {
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

/**
 * Sets up a test database with schema
 * @returns {Promise<sqlite3.Database>}
 */
async function setupTestDatabase() {
    const db = await createTestDatabase();
    await initializeTestDatabaseSchema(db);
    return db;
}

/**
 * Closes a test database
 * @param {sqlite3.Database} db - The database instance
 * @returns {Promise<void>}
 */
function teardownTestDatabase(db) {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Helper to temporarily replace the database module's database instance with a test database
 * This allows existing code that uses database.get/run/all to work with test databases
 * @param {sqlite3.Database} testDb - The test database instance
 * @returns {Function} - A function to restore the original database
 */
function injectTestDatabase(testDb) {
    const databaseModule = require("../database");
    const originalDatabase = databaseModule.database;
    
    // Replace the database instance
    databaseModule.database = testDb;
    
    // Return restore function
    return () => {
        databaseModule.database = originalDatabase;
    };
}

module.exports = {
    createTestDatabase,
    setupTestDatabase,
    teardownTestDatabase,
    initializeTestDatabaseSchema,
    injectTestDatabase,
};

