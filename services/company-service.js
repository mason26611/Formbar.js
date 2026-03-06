const {dbRun} = require("@modules/database");
const {createPool} = require("@services/digipog-service");
const {createItem} = require("@services/inventory-service");

const crypto = require("crypto");

async function createCompany({name, description, iconUrl="", ownerId}) {
    const shareItemId = await createItem(`${name} Share`, `Share of ${name}`, 100, iconUrl, null);
    const poolId = await createPool(`${name} Developer Pool`, description, ownerId);

    const apiKey = crypto.randomBytes(64).toString("hex");
    const apiSecret = crypto.randomBytes(256).toString("hex");

    const result = await dbRun(
        "INSERT INTO companies (name, description, icon_url, share_item_id, pool_id, api_key, api_secret) VALUES (?, ?, ?, ?, ?, ?, ?)", 
        [name, description, iconUrl, shareItemId, poolId, apiKey, apiSecret]
    );
    return result.lastID;
}

module.exports = {
    createCompany,
}