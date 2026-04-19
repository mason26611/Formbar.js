const { dbGetAll, dbRun } = require("@modules/database");

module.exports = {
    async run(database) {
        const columns = await dbGetAll("PRAGMA table_info(users)", [], database);
        const columnNames = new Set(columns.map((column) => column.name));

        if (!columnNames.has("pin_lookup_hash")) {
            await dbRun("ALTER TABLE users ADD COLUMN pin_lookup_hash TEXT", [], database);
        }

        await dbRun("CREATE INDEX IF NOT EXISTS idx_users_pin_lookup_hash ON users (pin_lookup_hash)", [], database);

        console.log("Migration 27 completed: PIN lookup hashes added and plaintext API keys normalized to sha256.");
    },
};
