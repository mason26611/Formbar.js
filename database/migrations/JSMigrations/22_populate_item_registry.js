// 22_populate_item_registry.js
// This migration populates item_registry from database/items.csv.

const fs = require("fs");
const csv = require("csv-parser");
const { dbGet, dbRun } = require("@modules/database");

const ITEMS_CSV_PATH = "./database/items.csv";

function readItemsFromCSV() {
    return new Promise((resolve, reject) => {
        const items = [];

        fs.createReadStream(ITEMS_CSV_PATH)
            .on("error", reject)
            .pipe(
                csv({
                    mapHeaders: ({ header }) => header.trim(),
                })
            )
            .on("error", reject)
            .on("data", (row) => {
                items.push({
                    name: row.name,
                    description: row.desc,
                    stackSize: Number.parseInt(row.stackSize, 10),
                });
            })
            .on("end", () => resolve(items));
    });
}

module.exports = {
    async run(database) {
        const table = await dbGet("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_registry'", [], database);
        if (!table) {
            throw new Error("ALREADY_DONE");
        }

        const itemCount = await dbGet("SELECT COUNT(*) AS count FROM item_registry", [], database);
        if (itemCount.count > 0) {
            throw new Error("ALREADY_DONE");
        }

        const items = await readItemsFromCSV();

        try {
            await dbRun("BEGIN TRANSACTION", [], database);

            for (const item of items) {
                await dbRun("INSERT OR IGNORE INTO item_registry (name, description, stack_size) VALUES (?, ?, ?)", [
                    item.name,
                    item.description,
                    Number.isFinite(item.stackSize) ? item.stackSize : 1,
                ]);
            }

            await dbRun("COMMIT", [], database);
        } catch (err) {
            try {
                await dbRun("ROLLBACK", [], database);
            } catch {
                // Ignore rollback failures if no active transaction exists.
            }
            throw err;
        }
    },
};
