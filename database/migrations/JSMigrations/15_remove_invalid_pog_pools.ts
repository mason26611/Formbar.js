// 15_remove_invalid_pog_pools.ts
// This migration removes pog pools that do not have an owner.

import sqlite3 = require("sqlite3");

const { dbGetAll, dbRun } = require("@modules/database") as {
    dbGetAll: <T>(query: string, params?: unknown[], db?: sqlite3.Database) => Promise<T[]>;
    dbRun: (query: string, params: unknown[], db: sqlite3.Database) => Promise<number>;
};

interface DigipogPoolRow {
    id: number;
    name: string;
}

interface DigipogPoolUserRow {
    pool_id: number;
    owner: number;
}

module.exports = {
    async run(database: sqlite3.Database): Promise<void> {
        try {
            await dbRun("BEGIN TRANSACTION", [], database);

            // Get all pools and pool users
            const pools = await dbGetAll<DigipogPoolRow>("SELECT * FROM digipog_pools");
            const poolUsers = await dbGetAll<DigipogPoolUserRow>("SELECT * FROM digipog_pool_users");

            // Identify pool IDs that have at least one owner
            const validPoolIds = new Set(poolUsers.filter((poolUser) => poolUser.owner).map((poolUser) => poolUser.pool_id));
            const poolIds = new Set(pools.map((pool) => pool.id));

            for (const poolId of poolIds) {
                if (!validPoolIds.has(poolId)) {
                    const pool = pools.find((pool) => pool.id === poolId);
                    const name = pool?.name ?? "unknown";
                    console.log(`Removing invalid pool ${name} (id: ${poolId})`);

                    // Remove the pog pool and any associated users
                    await dbRun("DELETE FROM digipog_pools WHERE id = ?", [poolId], database);
                    await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [poolId], database);
                }
            }

            await dbRun("COMMIT", [], database);
        } catch (err) {
            await dbRun("ROLLBACK", [], database);
            throw new Error("ALREADY_DONE");
        }
    },
};
