// 16_update_poll_history.ts
// This migration makes the poll_history table easier to query. It extracts poll data and responses into separate fields.

import sqlite3 = require("sqlite3");

const { dbGetAll, dbRun } = require("@modules/database") as {
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

interface LegacyPollHistoryRow {
    id: number;
    class: number;
    data: string;
    date: string | null;
}

interface PollData {
    prompt?: string;
    responses?: unknown;
    allowMultipleResponses?: boolean;
    blind?: boolean;
    allowTextResponses?: boolean;
}

module.exports = {
    async run(database: sqlite3.Database): Promise<void> {
        try {
            // Check if migration is needed by looking for the 'data' column
            const columns = await dbGetAll<PragmaColumnInfo>("PRAGMA table_info(poll_history)", [], database);
            const dataColumn = columns.find((column) => column.name === "data");
            if (!dataColumn) {
                // 'data' column no longer exists, migration already done
                throw new Error("ALREADY_DONE");
            }

            await dbRun("BEGIN TRANSACTION", [], database);

            // Get all existing poll history entries
            const pollHistory = await dbGetAll<LegacyPollHistoryRow>("SELECT * FROM poll_history", [], database);

            // Create new poll history table with updated schema
            await dbRun(
                `CREATE TABLE IF NOT EXISTS poll_history_temp (
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

            // Go through each poll entry and extract data from JSON
            for (const pollEntry of pollHistory) {
                let pollData: PollData = {};
                try {
                    pollData = JSON.parse(pollEntry.data) as PollData;
                } catch {
                    // If data is not valid JSON, skip this entry
                    continue;
                }

                const prompt = pollData.prompt || null;
                const responses = pollData.responses ? JSON.stringify(pollData.responses) : null;
                const allowMultipleResponses = pollData.allowMultipleResponses ? 1 : 0;
                const blind = pollData.blind ? 1 : 0;
                const allowTextResponses = pollData.allowTextResponses ? 1 : 0;

                // Convert legacy text date to midnight timestamp
                let createdAt = 0;
                if (pollEntry.date) {
                    const parsed = new Date(pollEntry.date + "T00:00:00.000Z");
                    if (!isNaN(parsed.getTime())) {
                        createdAt = parsed.getTime();
                    }
                }

                await dbRun(
                    `INSERT INTO poll_history_temp (id, class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [pollEntry.id, pollEntry.class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt],
                    database
                );
            }

            // Drop the old table and rename the new one
            await dbRun("DROP TABLE poll_history", [], database);
            await dbRun("ALTER TABLE poll_history_temp RENAME TO poll_history", [], database);

            await dbRun("COMMIT", [], database);
            console.log("Poll history migration completed successfully!");
        } catch (err) {
            // Check if this is because migration was already done
            if ((err as Error).message === "ALREADY_DONE") {
                throw err;
            }

            // Try to rollback for other errors
            try {
                await dbRun("ROLLBACK", [], database);
            } catch {
                // Transaction may not be active
            }
            throw err;
        }
    },
};
