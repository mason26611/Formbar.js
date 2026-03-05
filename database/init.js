// Support module aliases for importing
require("module-alias/register");

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const csv = require("csv-parser");

const itemsCSVPath = "./database/items.csv";
const createItemRegistryTableSQL = `
    CREATE TABLE IF NOT EXISTS item_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        stack_size INTEGER NOT NULL DEFAULT 1 CHECK (stack_size >= 0),
        image_url TEXT
    )
`;

initializeDatabase().catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
});

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
        await runStatement(database, createItemRegistryTableSQL);
        await populateItemRegistry(database);
        await runStatement(database, "COMMIT");
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

    // Set flag to skip backup during init, then run the migrations
    process.env.SKIP_BACKUP = "true";
    require("./migrate.js");
}

function populateItemRegistry(database) {
    return new Promise((resolve, reject) => {
        const items = [];

        fs.createReadStream(itemsCSVPath)
            .on("error", reject)
            .pipe(
                csv({
                    mapHeaders: ({ header }) => header.trim(),
                })
            )
            .on("error", reject)
            .on("data", (data) => {
                items.push({
                    name: data.name,
                    description: data.desc,
                    stackSize: parseInt(data.stackSize, 10),
                });
            })
            .on("end", async () => {
                try {
                    for (const item of items) {
                        const { name, description, stackSize } = item;
                        await runStatement(database, "INSERT INTO item_registry (name, description, stack_size) VALUES (?, ?, ?)", [
                            name,
                            description,
                            stackSize,
                        ]);
                    }
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
    });
}

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
