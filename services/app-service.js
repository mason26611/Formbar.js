const crypto = require("crypto");
const { dbRun } = require("@modules/database");
const { sha256 } = require("@modules/crypto");
const { createPool } = require("@services/digipog-service");
const { createItem, addItemToInventory } = require("@services/inventory-service");

const SHARES_PER_APP = 100;

async function createApp({ name, description, ownerId }) {
    await dbRun("BEGIN TRANSACTION");

    try {
        const shareItemId = await createItem({
            name: `${name} Share`,
            description: `Share of ${name}`,
            stackSize: 100,
            iconUrl: null,
        });
        const poolId = await createPool({ poolName: `${name} Developer Pool`, description, ownerId });

        const apiKey = crypto.randomBytes(64).toString("hex");
        const apiSecret = crypto.randomBytes(256).toString("hex");
        const hashedAPIKey = sha256(apiKey);
        const hashedAPISecret = sha256(apiSecret);

        const appId = await dbRun(
            "INSERT INTO apps (name, description, owner_user_id, share_item_id, pool_id, api_key_hash, api_secret_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [name, description, ownerId, shareItemId, poolId, hashedAPIKey, hashedAPISecret]
        );

        await addItemToInventory(ownerId, shareItemId, SHARES_PER_APP);
        await dbRun("COMMIT");

        return {
            appId,
            apiKey,
            apiSecret,
        };
    } catch (error) {
        await dbRun("ROLLBACK");
        throw error;
    }
}

module.exports = {
    createApp,
};
