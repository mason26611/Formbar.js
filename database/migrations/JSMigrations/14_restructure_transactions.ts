// 14_restructure_transactions.ts
// This migration restructures the 'transactions' table to support transactions from digipog pools, to users or other pools.

import sqlite3 = require("sqlite3");

const { dbGetAll, dbRun } = require("../../../modules/database") as {
    dbGetAll: <T>(query: string, params: unknown[], db: sqlite3.Database) => Promise<T[]>;
    dbRun: (query: string, params: unknown[], db: sqlite3.Database) => Promise<number>;
};

interface PragmaColumnInfo {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}

interface LegacyTransactionRow {
    from_user: number | null;
    to_user: number | null;
    pool: number | null;
    amount: number;
    reason: string;
    date: string;
}

module.exports = {
    async run(database: sqlite3.Database): Promise<void> {
        const columns = await dbGetAll<PragmaColumnInfo>("PRAGMA table_info(transactions)", [], database);
        const fromUserColumn = columns.find((column) => column.name === "from_user");
        if (fromUserColumn) {
            // If the column exists, then this is a legacy transactions table
            // Transfer the data to a new table with the new layout
            const transactions = await dbGetAll<LegacyTransactionRow>("SELECT * FROM transactions", [], database);

            // Create new temporary table
            await dbRun(
                `CREATE TABLE IF NOT EXISTS transactions_temp (
                    "from_id"   INTEGER NOT NULL,
                    "to_id"     INTEGER NOT NULL,
                    "from_type" TEXT NOT NULL,
                    "to_type"   TEXT NOT NULL,
                    "amount"    INTEGER NOT NULL,
                    "reason"    TEXT NOT NULL DEFAULT 'None',
                    "date"      TEXT NOT NULL
                );`,
                [],
                database
            );

            // Migrate data
            for (const transaction of transactions) {
                let fromId: number;
                let fromType: string;
                let toId: number;
                let toType: string;

                if (!transaction.from_user && transaction.pool) {
                    // Pool to user transaction
                    fromId = transaction.pool;
                    fromType = "pool";
                    toId = transaction.to_user!;
                    toType = "user";
                } else if (!transaction.to_user && transaction.pool) {
                    // User to pool transaction
                    toId = transaction.pool;
                    toType = "pool";
                    fromId = transaction.from_user!;
                    fromType = "user";
                } else if (transaction.from_user && transaction.to_user) {
                    // User to user transaction
                    fromId = transaction.from_user;
                    fromType = "user";
                    toId = transaction.to_user;
                    toType = "user";
                } else if (!transaction.from_user && transaction.to_user) {
                    // Pool to user transaction
                    fromId = 0;
                    fromType = "pool";
                    toId = transaction.to_user;
                    toType = "user";
                } else if (transaction.from_user && !transaction.to_user) {
                    // User to pool transaction
                    fromId = transaction.from_user;
                    fromType = "user";
                    toId = 0;
                    toType = "pool";
                } else {
                    throw new Error("Invalid transaction data");
                }

                await dbRun(
                    "INSERT INTO transactions_temp (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [fromId, toId, fromType, toType, transaction.amount, transaction.reason, transaction.date],
                    database
                );
            }

            // Drop the old transactions table and rename the new one
            await dbRun("DROP TABLE IF EXISTS transactions", [], database);
            await dbRun("ALTER TABLE transactions_temp RENAME TO transactions", [], database);
        } else {
            throw new Error("ALREADY_DONE");
        }
    },
};
