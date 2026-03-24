/**
 * @module migrate
 * @description Schema-versioned migration runner for Formbar.js.
 *
 * Runs the compacted legacy migration if schema_version < 1, then executes
 * any individual SQL/JS migration files in order. New migrations are added as
 * numbered files; compact again on major version changes.
 */

require("module-alias/register");

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const COMPACT_VERSION = 1;

/**
 * @param {sqlite3.Database} db
 * @param {string} sql
 * @param {any[]} [params=[]]
 * @returns {Promise<object|undefined>}
 */
function queryOne(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

/**
 * @param {sqlite3.Database} db
 * @param {string} sql
 * @param {any[]} [params=[]]
 * @returns {Promise<object>}
 */
function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

/**
 * @param {sqlite3.Database} db
 * @param {string} sql
 * @returns {Promise<void>}
 */
function exec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => (err ? reject(err) : resolve()));
    });
}

/**
 * @param {sqlite3.Database} db
 * @returns {Promise<void>}
 */
function closeDb(db) {
    return new Promise((resolve, reject) => {
        db.close((err) => (err ? reject(err) : resolve()));
    });
}

/**
 * Returns the current schema version from the database, or 0 if untracked.
 * @param {sqlite3.Database} db
 * @returns {Promise<number>}
 */
async function getSchemaVersion(db) {
    const table = await queryOne(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'");
    if (!table) return 0;

    const row = await queryOne(db, "SELECT version FROM schema_version LIMIT 1");
    return row ? row.version : 0;
}

/**
 * Collects SQL migrations from `database/migrations/` and JS migrations from
 * `database/migrations/JSMigrations/`, sorted by filename.
 * @returns {{type: string, filename: string, path: string}[]}
 */
function collectMigrations() {
    const migDir = "./database/migrations";
    const jsDir = `${migDir}/JSMigrations`;

    const sqlMigrations = fs
        .readdirSync(migDir)
        .filter((file) => file.endsWith(".sql"))
        .map((file) => ({
            type: "sql",
            filename: file,
            path: `${migDir}/${file}`,
        }));

    if (!fs.existsSync(jsDir)) {
        fs.mkdirSync(jsDir);
    }

    const jsMigrations = fs
        .readdirSync(jsDir)
        .filter((file) => file.endsWith(".js"))
        .map((file) => ({
            type: "js",
            filename: file,
            path: `${jsDir}/${file}`,
        }));

    return [...sqlMigrations, ...jsMigrations].sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * Runs a single SQL migration file inside a transaction.
 * Rolls back and continues if the migration was already applied.
 * @param {sqlite3.Database} db
 * @param {{path: string}} migration
 */
async function executeSQLMigration(db, migration) {
    const migrationSQL = fs.readFileSync(migration.path, "utf8");

    await run(db, "BEGIN TRANSACTION");
    try {
        await exec(db, migrationSQL);
        await run(db, "COMMIT");
    } catch (err) {
        await run(db, "ROLLBACK").catch(() => {});

        if (process.argv.includes("verbose")) {
            console.error(err);
        }

        console.log("  Unable to complete migration as it has already been run, or an error occurred. Continuing to next migration.");
    }
}

/**
 * Runs a single JS migration module. Skips if the module throws "ALREADY_DONE".
 * @param {sqlite3.Database} db
 * @param {{path: string}} migration
 */
async function executeJSMigration(db, migration) {
    try {
        const migrationModule = require(migration.path);
        await migrationModule.run(db);
    } catch (err) {
        if (err.message === "ALREADY_DONE") {
            console.log("  Already applied. Skipping.");
            return;
        }
        throw err;
    }
}

/** Creates a numbered backup of the database file. */
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

/** Runs all pending migrations against the database. */
async function migrate() {
    if (!fs.existsSync("database/database.db")) {
        console.log("No database found. Run init.js first.");
        process.exit(1);
    }

    const db = new sqlite3.Database("./database/database.db");

    try {
        const version = await getSchemaVersion(db);
        console.log(`Current schema version: ${version}`);

        // Bring old databases up to baseline via compact migration
        // Eventually this should support multiple compacted migrations but that's a later issue
        if (version < COMPACT_VERSION) {
            backupDatabase();
            console.log(`Running compacted legacy migration (${version} → ${COMPACT_VERSION})...`);
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

        // Run any individual SQL/JS migrations added after compaction
        const migrations = collectMigrations();
        if (migrations.length > 0) {
            for (const migration of migrations) {
                console.log(`Running ${migration.type.toUpperCase()} migration: ${migration.filename}`);
                if (migration.type === "sql") {
                    await executeSQLMigration(db, migration);
                } else {
                    await executeJSMigration(db, migration);
                }
                console.log(`  Completed: ${migration.filename}`);
            }
        }

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
