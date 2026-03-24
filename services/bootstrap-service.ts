import type { DigipogPoolRow } from "../types/database";

const { dbGet, dbRun } = require("@modules/database") as {
    dbGet: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    dbRun: (sql: string, params?: unknown[]) => Promise<number>;
};

async function ensureFormbarDeveloperPool(): Promise<void> {
    const formbarDevPool = await dbGet<DigipogPoolRow>("SELECT * FROM digipog_pools WHERE id = 0");
    if (formbarDevPool) {
        return;
    }

    await dbRun("INSERT INTO digipog_pools (id, name, description, amount) VALUES (?, ?, ?, ?)", [
        0,
        "Formbar Developer Pool",
        "Formbar Developer pog pool. Accumulates from the 10% tax on digipog transactions.",
        0,
    ]);
    await dbRun("INSERT INTO digipog_pool_users (pool_id, user_id, owner) VALUES (?, ?, ?)", [0, 1, 1]);
}

module.exports = {
    ensureFormbarDeveloperPool,
};
