const {dbRun} = require("@modules/database");
const {createPool} = require("@services/digipog-service");
const {createItem} = require("@services/inventory-service");

const crypto = require("crypto");

async function createApp({name, description, ownerId}) {
    const shareItemId = await createItem(`${name} Share`, `Share of ${name}`, 100, null);
    const poolId = await createPool(`${name} Developer Pool`, description, ownerId);

    const apiKey = crypto.randomBytes(64).toString("hex");
    const apiSecret = crypto.randomBytes(256).toString("hex");

    const result = await dbRun(
        "INSERT INTO apps (name, description, share_item_id, pool_id, api_key, api_secret) VALUES (?, ?, ?, ?, ?, ?)", 
        [name, description, shareItemId, poolId, apiKey, apiSecret]
    );
    return result.lastID;
}

module.exports = {
    createApp,
}