/**
 * @module init
 * @description Creates a fresh Formbar.js database from init.sql and populates
 * seed data (item_registry from CSV). Exits if a database already exists.
 */

require("module-alias/register");

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const csv = require("csv-parser");

initializeDatabase().catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
});

/**
 * Creates the database from init.sql and populates the item registry.
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
    if (fs.existsSync("./database/database.db")) {
        console.log("Database already exists. Skipping initialization.");
        process.exit(1);
    }

    if (!fs.existsSync("./database/init.sql")) {
        console.log("SQL initialization file not found.");
        process.exit(1);
    }

    const initSQL = fs.readFileSync("./database/init.sql", "utf8");
    const database = new sqlite3.Database("./database/database.db");

    try {
        await runStatement(database, "BEGIN TRANSACTION");
        await execStatement(database, initSQL);
        await runStatement(database, "COMMIT");
        console.log("Schema created successfully.");

        await populateItemRegistry(database);
    } catch (err) {
        try {
            await runStatement(database, "ROLLBACK");
        } catch {
            // Ignore rollback failures so the original error is preserved.
        }
        throw err;
    } finally {
        await closeDatabase(database);
    }

    console.log("Database initialized successfully.");
}

/**
 * Reads items.csv and inserts rows into the item_registry table.
 * @param {sqlite3.Database} database
 * @returns {Promise<void>}
 */
async function populateItemRegistry(database) {
    const csvPath = "./database/items.csv";
    if (!fs.existsSync(csvPath)) {
        console.log("items.csv not found, skipping item_registry population.");
        return;
    }

    const items = await new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(csvPath)
            .on("error", reject)
            .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
            .on("error", reject)
            .on("data", (row) => results.push(row))
            .on("end", () => resolve(results));
    });

    if (items.length === 0) return;

    await runStatement(database, "BEGIN TRANSACTION");
    try {
        for (const item of items) {
            const stackSize = parseInt(item.stackSize, 10);
            await runStatement(database, "INSERT OR IGNORE INTO item_registry (name, description, stack_size) VALUES (?, ?, ?)", [
                item.name,
                item.desc,
                Number.isFinite(stackSize) ? stackSize : 1,
            ]);
        }
        await runStatement(database, "COMMIT");
        console.log(`Populated item_registry with ${items.length} items.`);
    } catch (err) {
        await runStatement(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

/**
 * @param {sqlite3.Database} database
 * @param {string} sql
 * @param {any[]} [params=[]]
 * @returns {Promise<void>}
 */
function runStatement(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

/**
 * @param {sqlite3.Database} database
 * @param {string} sql
 * @returns {Promise<void>}
 */
function execStatement(database, sql) {
    return new Promise((resolve, reject) => {
        database.exec(sql, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

/**
 * @param {sqlite3.Database} database
 * @returns {Promise<void>}
 */
function closeDatabase(database) {
    return new Promise((resolve, reject) => {
        database.close((err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

module.exports = {
    initializeDatabase,
};
