const add = require("@controllers/room/links/add");
const { dbRun } = require("@modules/database");
const { createPool } = require("@services/digipog-service");
const { createItem, addItemToInventory } = require("@services/inventory-service");

const crypto = require("crypto");

async function createApp({ name, description, ownerId }) {

    await dbRun("BEGIN TRANSACTION");

    try {

        const shareItemId = await createItem({
            name: `${name} Share`,
            description: `Share of ${name}`,
            stackSize: 100,
            iconUrl: null
        }
        );
        const poolId = await createPool(`${name} Developer Pool`, description, ownerId);

        const apiKey = crypto.randomBytes(64).toString("hex");
        const apiSecret = crypto.randomBytes(256).toString("hex");

        const appId = await dbRun(
            "INSERT INTO apps (name, description, share_item_id, pool_id, api_key, api_secret) VALUES (?, ?, ?, ?, ?, ?)",
            [name, description, shareItemId, poolId, apiKey, apiSecret]
        );

        await addItemToInventory(ownerId, shareItemId, 100);

        await dbRun("COMMIT");

        return appId;

    } catch (error) {

        await dbRun("ROLLBACK");
        throw error;

    }
}

module.exports = {
    createApp,
}