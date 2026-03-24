// 17_update_poll_answers.ts
// This migration salvages legacy poll answer data from poll_history's names, letter, and text columns
// into the poll_answers table, then removes those columns from poll_history.

import sqlite3 = require("sqlite3");

const { dbRun, dbGetAll } = require("@modules/database") as {
    dbRun: (query: string, params: unknown[], db: sqlite3.Database) => Promise<number>;
    dbGetAll: <T>(query: string, params: unknown[], db: sqlite3.Database) => Promise<T[]>;
};

interface PragmaColumnInfo {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}

interface LegacyPollHistoryRow {
    id: number;
    class: number;
    names: string | null;
    letter: string | null;
    text: string | null;
}

interface UserIdRow {
    id: number;
}

module.exports = {
    async run(database: sqlite3.Database): Promise<void> {
        try {
            // Check if migration has already run by checking for classId column in poll_answers
            const tableInfo = await dbGetAll<PragmaColumnInfo>("PRAGMA table_info(poll_answers)", [], database);
            const hasClassId = tableInfo.some((col) => col.name === "classId");
            if (hasClassId) {
                return;
            }

            await dbRun("BEGIN TRANSACTION", [], database);

            // Drop old poll_answers and recreate with correct structure including createdAt
            await dbRun("DROP TABLE IF EXISTS poll_answers", [], database);
            await dbRun(
                `CREATE TABLE poll_answers (
                    pollId INTEGER NOT NULL,
                    classId INTEGER NOT NULL,
                    userId INTEGER NOT NULL,
                    buttonResponse TEXT,
                    textResponse TEXT,
                    createdAt INTEGER,
                    PRIMARY KEY (userId, pollId)
                )`,
                [],
                database
            );

            // Salvage legacy data from poll_history's names, letter, and text columns
            const historyColumns = await dbGetAll<PragmaColumnInfo>("PRAGMA table_info(poll_history)", [], database);
            const hasNames = historyColumns.some((col) => col.name === "names");

            if (hasNames) {
                const pollHistory = await dbGetAll<LegacyPollHistoryRow>("SELECT id, class, names, letter, text FROM poll_history", [], database);

                for (const entry of pollHistory) {
                    let names: string[] = [];
                    let letters: (string | string[])[] = [];
                    let texts: string[] = [];

                    try {
                        names = entry.names ? (JSON.parse(entry.names) as string[]) : [];
                    } catch {
                        names = [];
                    }
                    try {
                        letters = entry.letter ? (JSON.parse(entry.letter) as (string | string[])[]) : [];
                    } catch {
                        letters = [];
                    }
                    try {
                        texts = entry.text ? (JSON.parse(entry.text) as string[]) : [];
                    } catch {
                        texts = [];
                    }

                    if (!Array.isArray(names) || names.length === 0) continue;

                    for (let i = 0; i < names.length; i++) {
                        const email = names[i];

                        // letters[i] can be an array (e.g. ["A","B"]) or a string
                        let buttonResponse: string | null = null;
                        const rawLetter = letters[i];
                        if (Array.isArray(rawLetter) && rawLetter.length > 0) {
                            buttonResponse = JSON.stringify(rawLetter);
                        } else if (typeof rawLetter === "string" && rawLetter !== "") {
                            buttonResponse = JSON.stringify([rawLetter]);
                        }

                        const rawText = texts[i];
                        const textResponse = typeof rawText === "string" && rawText !== "" ? rawText : null;

                        // Skip if both responses are null
                        if (buttonResponse === null && textResponse === null) continue;

                        // Look up userId by email
                        const users = await dbGetAll<UserIdRow>("SELECT id FROM users WHERE email = ?", [email], database);

                        if (users.length === 0) continue;

                        const userId = users[0].id;

                        // Insert into poll_answers, ignore duplicates
                        await dbRun(
                            `INSERT OR IGNORE INTO poll_answers (pollId, classId, userId, buttonResponse, textResponse, createdAt)
                             VALUES (?, ?, ?, ?, ?, NULL)`,
                            [entry.id, entry.class, userId, buttonResponse, textResponse],
                            database
                        );
                    }
                }

                // Remove names, letter, and text columns from poll_history by recreating the table
                await dbRun(
                    `CREATE TABLE poll_history_temp (
                        "id"                       INTEGER NOT NULL UNIQUE,
                        "class"                    INTEGER NOT NULL,
                        "prompt"                   TEXT,
                        "responses"                TEXT,
                        "allowMultipleResponses"   INTEGER NOT NULL DEFAULT 0,
                        "blind"                    INTEGER NOT NULL DEFAULT 0,
                        "allowTextResponses"       INTEGER NOT NULL DEFAULT 0,
                        "createdAt"                INTEGER NOT NULL,
                        PRIMARY KEY ("id" AUTOINCREMENT)
                    )`,
                    [],
                    database
                );

                await dbRun(
                    `INSERT INTO poll_history_temp (id, class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt)
                     SELECT id, class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt FROM poll_history`,
                    [],
                    database
                );

                await dbRun("DROP TABLE poll_history", [], database);
                await dbRun("ALTER TABLE poll_history_temp RENAME TO poll_history", [], database);
            }

            await dbRun("COMMIT", [], database);
            console.log("Migration 17 completed: poll_answers recreated with classId and createdAt columns.");
        } catch (err) {
            try {
                await dbRun("ROLLBACK", [], database);
            } catch {
                // Transaction may not be active
            }
            throw err;
        }
    },
};
