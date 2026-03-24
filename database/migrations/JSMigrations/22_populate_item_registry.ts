// 22_populate_item_registry.ts
// This migration populates item_registry from database/items.csv.

import sqlite3 = require("sqlite3");
import fs = require("fs");
import csv = require("csv-parser");

const { dbGet, dbRun } = require("@modules/database") as {
    dbGet: <T>(query: string, params: unknown[], db: sqlite3.Database) => Promise<T | undefined>;
    dbRun: (query: string, params: unknown[], db?: sqlite3.Database) => Promise<number>;
};

const ITEMS_CSV_PATH = "./database/items.csv";

interface CsvRow {
    name: string;
    desc: string;
    stackSize: string;
}

interface ParsedItem {
    name: string;
    description: string;
    stackSize: number;
}

interface SqliteMasterRow {
    name: string;
}

interface CountRow {
    count: number;
}

function readItemsFromCSV(): Promise<ParsedItem[]> {
    return new Promise((resolve, reject) => {
        const items: ParsedItem[] = [];

        fs.createReadStream(ITEMS_CSV_PATH)
            .on("error", reject)
            .pipe(
                csv({
                    mapHeaders: ({ header }: { header: string }) => header.trim(),
                })
            )
            .on("error", reject)
            .on("data", (row: CsvRow) => {
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
    async run(database: sqlite3.Database): Promise<void> {
        const table = await dbGet<SqliteMasterRow>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'item_registry'", [], database);
        if (!table) {
            throw new Error("ALREADY_DONE");
        }

        const itemCount = await dbGet<CountRow>("SELECT COUNT(*) AS count FROM item_registry", [], database);
        if (itemCount && itemCount.count > 0) {
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
