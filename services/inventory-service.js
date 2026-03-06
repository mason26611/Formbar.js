const { dbGet, dbGetAll, dbRun } = require("@modules/database");
const NotFoundError = require("@modules/errors/NotFoundError");

async function getInventory(userId) {
    const inventoryItems = await dbGetAll("SELECT item_id, quantity FROM inventory WHERE user_id = ?", [userId]);
    return inventoryItems;
}

async function createItem(name, description, stackSize = 1, iconUrl = "", companyId) {
    const result = await dbRun("INSERT INTO items (name, description, stack_size, image_url, company_id) VALUES (?, ?, ?, ?, ?)", [name, description, stackSize, iconUrl, companyId]);
    return result.lastID;
}

async function addItemToInventory(userId, itemId, quantity) {
    // Check if the item already exists in the user's inventory
    const existingItem = await dbGet("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
    if (existingItem) {
        // If it exists, update the quantity
        const newQuantity = existingItem.quantity + quantity;
        await dbRun("UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?", [newQuantity, userId, itemId]);
    } else {
        // If it doesn't exist, insert a new record
        await dbRun("INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)", [userId, itemId, quantity]);
    }
}

async function removeItemFromInventory(userId, itemId, quantity) {
    // Check if the item exists in the user's inventory
    const existingItem = await dbGet("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
    if (existingItem) {
        const newQuantity = existingItem.quantity - quantity;

        if (newQuantity > 0) {
            // If the new quantity is greater than 0, update the record
            await dbRun("UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?", [newQuantity, userId, itemId]);
        } else {
            // If the new quantity is 0 or less, remove the record
            await dbRun("DELETE FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
        }
    } else {
        throw new NotFoundError("Item not found in inventory");
    }
}

module.exports = {
    getInventory,
    createItem,
    addItemToInventory,
    removeItemFromInventory,
};
