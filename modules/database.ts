import sqlite3 = require("sqlite3");

type Database = sqlite3.Database;

const database: Database = getDatabase();

/**
 * Return an open sqlite3 Database connected to the project's DB file.
 */
function getDatabase(): Database {
    return new sqlite3.Database("database/database.db");
}

/**
 * Execute a single-row SELECT query and return the first row.
 */
function dbGet<T = Record<string, unknown>>(query: string, params?: unknown[], db: Database = database): Promise<T | undefined> {
    const callStack = new Error().stack;
    return new Promise((resolve, reject) => {
        db.get(query, params, (err: Error | null, row: unknown) => {
            if (err) {
                console.error(callStack);
                return reject(err);
            }
            resolve(row as T | undefined);
        });
    });
}

/**
 * Execute a statement that modifies the database (INSERT, UPDATE, DELETE).
 * Resolves with the last inserted row id (this.lastID) for INSERT statements.
 */
function dbRun(query: string, params?: unknown[], db: Database = database): Promise<number> {
    const callStack = new Error().stack;
    return new Promise((resolve, reject) => {
        db.run(query, params, function (this: sqlite3.RunResult, err: Error | null) {
            if (err) {
                console.error(callStack);
                return reject(err);
            }
            resolve(this.lastID);
        });
    });
}

/**
 * Execute a query that returns multiple rows.
 */
function dbGetAll<T = Record<string, unknown>>(query: string, params?: unknown[], db: Database = database): Promise<T[]> {
    const callStack = new Error().stack;
    return new Promise((resolve, reject) => {
        db.all(query, params, (err: Error | null, rows: unknown[]) => {
            if (err) {
                console.error(callStack);
                return reject(err);
            }
            resolve(rows as T[]);
        });
    });
}

module.exports = {
    database,
    dbGet,
    dbRun,
    dbGetAll,
};
