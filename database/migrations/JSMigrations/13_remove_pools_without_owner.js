// 13_remove_pools_without_owner.js
// This migration removes all pog pools without an owner

const { dbRun, dbGetAll } = require("../../../modules/database");

module.exports = {
    async run(database) {
        await dbRun("BEGIN TRANSACTION", [], database);
        try {
            const pools = await dbGetAll("SELECT * FROM digipog_pools", [], database);
            for (const pool of pools) {
                const users = await dbGetAll("SELECT * FROM digipog_pool_users WHERE pool_id = ?", [pool.id], database);

                // If there are no users in the pool, delete the pool
                if (users.length === 0) {
                    await dbRun("DELETE FROM digipog_pools WHERE id = ?", [pool.id], database);
                    continue;
                }

                // If there are users, check if any of them is an owner
                const ownerUser = users.find((user) => user.owner === 1);
                if (!ownerUser) {
                    // No owner found, delete the pool
                    await dbRun("DELETE FROM digipog_pools WHERE id = ?", [pool.id], database);
                }

                // Delete all users associated with the deleted pool
                await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [pool.id], database);
                console.log(`Deleted pool with id ${pool.id} due to no owner.`);
            }
        } catch (err) {
            await dbRun("ROLLBACK", [], database);
            throw err;
        }
        await dbRun("COMMIT", [], database);
    },
};
