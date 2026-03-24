// 11_convert_transaction_timestamps.ts
// This migration converts any ISO 8601 formatted timestamps in the 'date' column of the 'transactions' table to unix timestamps.

import sqlite3 = require("sqlite3");

const { dbGetAll, dbRun } = require("../../../modules/database") as {
    dbGetAll: <T>(query: string, params: unknown[], db: sqlite3.Database) => Promise<T[]>;
    dbRun: (query: string, params: unknown[], db: sqlite3.Database) => Promise<number>;
};

interface TransactionDateRow {
    date: string;
}

module.exports = {
    async run(database: sqlite3.Database): Promise<void> {
        const transactions = await dbGetAll<TransactionDateRow>("SELECT date FROM transactions", [], database);
        await dbRun("BEGIN TRANSACTION", [], database);
        try {
            for (const tx of transactions) {
                if (typeof tx.date === "string" && tx.date.includes("T")) {
                    // Check if timestamp is in ISO 8601 format
                    const date = new Date(tx.date);
                    const time = date.getTime();
                    if (Number.isNaN(time)) {
                        console.warn(`Skipping invalid ISO 8601 timestamp in transactions.date: ${tx.date}`);
                        continue;
                    }
                    const unixTimestamp = Math.floor(time);
                    await dbRun("UPDATE transactions SET date = ? WHERE date = ?", [unixTimestamp, tx.date]);
                }
            }
        } catch (err) {
            await dbRun("ROLLBACK", [], database);
            throw err;
        }
        await dbRun("COMMIT", [], database);
    },
};
