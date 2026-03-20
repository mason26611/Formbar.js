// ===========================================================================
// migrate.js — Schema-versioned migration runner
//
// Checks the current schema_version and runs only the migrations needed.
// For old databases (no schema_version table or version < 1), runs the
// compacted legacy migration (00_legacy_compact.js) which idempotently
// brings the database to version 1.
// ===========================================================================

require("module-alias/register");

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function queryOne(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function queryAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function closeDb(db) {
    return new Promise((resolve, reject) => {
        db.close((err) => (err ? reject(err) : resolve()));
    });
}

// ---------------------------------------------------------------------------
// Determine current schema version
// ---------------------------------------------------------------------------

async function getSchemaVersion(db) {
    const table = await queryOne(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'");
    if (!table) return 0;

    const row = await queryOne(db, "SELECT version FROM schema_version LIMIT 1");
    return row ? row.version : 0;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

function backupDatabase() {
    if (!fs.existsSync("database/database.db") || process.env.SKIP_BACKUP) return;

    let backupNumber = fs.existsSync("database/database.bak") ? 1 : 0;
    while (fs.existsSync(`database/database-${backupNumber}.bak`)) {
        backupNumber++;
    }

    const backupPath = backupNumber === 0 ? "database/database.bak" : `database/database-${backupNumber}.bak`;
    fs.copyFileSync("database/database.db", backupPath);
    console.log(`Database backed up to ${backupPath}`);
}

// ---------------------------------------------------------------------------
// Run migrations
// ---------------------------------------------------------------------------

async function migrate() {
    if (!fs.existsSync("database/database.db")) {
        console.log("No database found. Run init.js first.");
        process.exit(1);
    }

    const db = new sqlite3.Database("./database/database.db");

    try {
        const version = await getSchemaVersion(db);
        console.log(`Current schema version: ${version}`);

        if (version >= CURRENT_SCHEMA_VERSION) {
            console.log("Database is up to date. No migrations needed.");
            return;
        }

        backupDatabase();

        // Version 0 → 1: Run the compacted legacy migration
        if (version < 1) {
            console.log("Running compacted legacy migration (0 → 1)...");
            const legacyCompact = require("./migrations/00_legacy_compact.js");
            try {
                await legacyCompact.run(db);
            } catch (err) {
                if (err.message === "ALREADY_DONE") {
                    console.log("Legacy migration already applied.");
                } else {
                    throw err;
                }
            }
        }

        // Future migrations would go here:
        // if (version < 2) { ... }
        // if (version < 3) { ... }

        const finalVersion = await getSchemaVersion(db);
        console.log(`Migration complete. Schema version: ${finalVersion}`);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    } finally {
        await closeDb(db);
    }
}

migrate();
