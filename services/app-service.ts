import crypto = require("crypto");

const { dbRun } = require("@modules/database") as {
    dbRun: (sql: string, params?: unknown[]) => Promise<number>;
};
const { sha256 } = require("@modules/crypto") as { sha256: (input: string) => string };
const { createPool } = require("@services/digipog-service") as {
    createPool: (params: { name: string; description: string; ownerId: number }) => Promise<number>;
};
const { createItem, addItemToInventory } = require("@services/inventory-service") as {
    createItem: (params: { name: string; description: string; stackSize: number; iconUrl: string | null }) => Promise<number>;
    addItemToInventory: (userId: number, itemId: number, quantity: number) => Promise<void>;
};

const SHARES_PER_APP = 100;

interface CreateAppParams {
    name: string;
    description: string;
    ownerId: number;
}

interface CreateAppResult {
    appId: number;
    apiKey: string;
    apiSecret: string;
}

async function createApp({ name, description, ownerId }: CreateAppParams): Promise<CreateAppResult> {
    await dbRun("BEGIN TRANSACTION");

    try {
        const shareItemId: number = await createItem({
            name: `${name} Share`,
            description: `Share of ${name}`,
            stackSize: SHARES_PER_APP,
            iconUrl: null,
        });
        const poolId: number = await createPool({ name: `${name} Developer Pool`, description, ownerId });

        const apiKey = crypto.randomBytes(64).toString("hex");
        const apiSecret = crypto.randomBytes(256).toString("hex");
        const hashedAPIKey: string = sha256(apiKey);
        const hashedAPISecret: string = sha256(apiSecret);

        const appId: number = await dbRun(
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
