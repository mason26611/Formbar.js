const NotFoundError = require("@errors/not-found-error");

const { dbGet, dbGetAll, dbRun } = require("@modules/database") as {
    dbGet: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    dbGetAll: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    dbRun: (sql: string, params?: unknown[]) => Promise<number>;
};

interface CreateItemParams {
    name: string;
    description: string;
    stackSize?: number;
    iconUrl?: string | null;
}

interface InventoryQuantityRow {
    quantity: number;
}

interface InventoryItemResult {
    item_id: number;
    quantity: number;
}

async function getInventory(userId: number): Promise<InventoryItemResult[]> {
    const inventoryItems = await dbGetAll<InventoryItemResult>("SELECT item_id, quantity FROM inventory WHERE user_id = ?", [userId]);
    return inventoryItems;
}

async function createItem({ name, description, stackSize = 1, iconUrl = "" }: CreateItemParams): Promise<number> {
    const itemId: number = await dbRun("INSERT INTO item_registry (name, description, stack_size, image_url) VALUES (?, ?, ?, ?)", [
        name,
        description,
        stackSize,
        iconUrl,
    ]);
    return itemId;
}

async function addItemToInventory(userId: number, itemId: number, quantity: number): Promise<void> {
    const existingItem = await dbGet<InventoryQuantityRow>("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
    if (existingItem) {
        const newQuantity = existingItem.quantity + quantity;
        await dbRun("UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?", [newQuantity, userId, itemId]);
    } else {
        await dbRun("INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)", [userId, itemId, quantity]);
    }
}

async function removeItemFromInventory(userId: number, itemId: number, quantity: number): Promise<void> {
    const existingItem = await dbGet<InventoryQuantityRow>("SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
    if (existingItem) {
        const newQuantity = existingItem.quantity - quantity;

        if (newQuantity > 0) {
            await dbRun("UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?", [newQuantity, userId, itemId]);
        } else {
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
