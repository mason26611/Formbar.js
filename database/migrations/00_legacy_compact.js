// 00_legacy_compact.js
// ===================================================================================
// Compacted migration that replaces all individual SQL and JS migrations (01–23) as of 3/20/2026.
// Fully idempotent: safe to run on a database at ANY migration state.
//
// Each section checks current schema state before making changes, so operations
// that have already been applied are skipped automatically.
// ===================================================================================

require("module-alias/register");

const fs = require("fs");
const csv = require("csv-parser");
const { hash } = require("@modules/crypto");
const { ROLES, ROLE_NAMES } = require("@modules/roles");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getColumns(database, table) {
    return query(database, `PRAGMA table_info(${table})`);
}

function hasColumn(columns, name) {
    return columns.some((col) => col.name === name);
}

function tableExists(database, name) {
    return query(database, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]).then((rows) => rows.length > 0);
}

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function query(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function queryOne(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

// ---------------------------------------------------------------------------
// Main migration entry point
// ---------------------------------------------------------------------------

module.exports = {
    async run(database) {
        // If the database already has a schema_version table at version >= 1, skip.
        if (await tableExists(database, "schema_version")) {
            const row = await queryOne(database, "SELECT version FROM schema_version LIMIT 1");
            if (row && row.version >= 1) {
                throw new Error("ALREADY_DONE");
            }
        }

        console.log("Running compacted legacy migration...");

        await step01_usersTable(database);
        await step02_linksTable(database);
        await step03_digipogPoolTables(database);
        await step04_classusersTable(database);
        await step05_customPollsColumns(database);
        await step06_classPermissionsTable(database);
        await step07_removeOldTables(database);
        await step08_refreshTokensCleanup(database);
        await step09_uniqueDisplayName(database);
        await step10_combineIpLists(database);
        await step11_refreshTokenType(database);
        await step12_hashRefreshTokens(database);
        await step13_usedAuthorizationCodes(database);
        await step14_digipogPoolUsersRestructure(database);
        await step15_hashApiKeysAndPins(database);
        await step16_convertTransactionTimestamps(database);
        await step17_lowercaseEmailsMergeDuplicates(database);
        await step18_restructureTransactions(database);
        await step19_removeInvalidPools(database);
        await step20_updatePollHistory(database);
        await step21_updatePollAnswers(database);
        await step22_newTables(database);
        await step23_populateItemRegistry(database);
        await step24_addRolesAndScopes(database);
        await step25_setSchemaVersion(database);

        console.log("Compacted legacy migration complete.");
    },
};

// ===========================================================================
// Step 1: Users table — ensure email column, pin column, remove username
// ===========================================================================
async function step01_usersTable(database) {
    if (!(await tableExists(database, "users"))) return;

    const cols = await getColumns(database, "users");
    const hasUsername = hasColumn(cols, "username");
    const hasEmail = hasColumn(cols, "email");
    const hasPin = hasColumn(cols, "pin");

    // If users table still has the old "username" column and needs restructuring
    if (hasUsername && hasEmail) {
        console.log("  [01] Restructuring users table (removing username, adding pin)...");
        await run(database, "BEGIN TRANSACTION");
        try {
            await run(
                database,
                `CREATE TABLE IF NOT EXISTS "users_temp" (
                    "id"          INTEGER NOT NULL UNIQUE,
                    "email"       TEXT    NOT NULL UNIQUE,
                    "password"    TEXT,
                    "permissions" INTEGER,
                    "API"         TEXT    NOT NULL UNIQUE,
                    "secret"      TEXT    NOT NULL UNIQUE,
                    "tags"        TEXT,
                    "digipogs"    INTEGER NOT NULL DEFAULT 0,
                    "pin"         TEXT,
                    "displayName" TEXT,
                    "verified"    INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY ("id" AUTOINCREMENT)
                )`
            );
            await run(
                database,
                `INSERT INTO users_temp (id, email, password, permissions, API, secret, tags, digipogs, pin, displayName, verified)
                 SELECT id, COALESCE(email, id || '@placeholder.com'), password, permissions, API, secret, tags, digipogs,
                        ${hasPin ? "pin" : "NULL"}, displayName, verified
                 FROM users`
            );
            await run(database, "DROP TABLE users");
            await run(database, "ALTER TABLE users_temp RENAME TO users");
            await run(database, "COMMIT");
        } catch (err) {
            await run(database, "ROLLBACK").catch(() => {});
            throw err;
        }
    } else if (!hasPin) {
        // Just add pin column if missing
        console.log("  [01] Adding pin column to users...");
        try {
            await run(database, "ALTER TABLE users ADD COLUMN pin TEXT");
        } catch {
            // Column may already exist
        }
    }
}

// ===========================================================================
// Step 2: Links table
// ===========================================================================
async function step02_linksTable(database) {
    if (await tableExists(database, "links")) return;
    console.log("  [02] Creating links table...");
    await run(
        database,
        `CREATE TABLE IF NOT EXISTS "links" (
            "id"      INTEGER NOT NULL UNIQUE,
            "name"    TEXT    NOT NULL,
            "url"     TEXT    NOT NULL,
            "classId" INTEGER NOT NULL,
            PRIMARY KEY ("id" AUTOINCREMENT)
        )`
    );
}

// ===========================================================================
// Step 3: Digipog pool tables
// ===========================================================================
async function step03_digipogPoolTables(database) {
    if (!(await tableExists(database, "digipog_pools"))) {
        console.log("  [03] Creating digipog_pools table...");
        await run(
            database,
            `CREATE TABLE IF NOT EXISTS "digipog_pools" (
                "id"          INTEGER NOT NULL UNIQUE,
                "name"        TEXT    NOT NULL,
                "description" TEXT    NOT NULL DEFAULT 'None',
                "amount"      INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ("id" AUTOINCREMENT)
            )`
        );
    }

    if (!(await tableExists(database, "digipog_pool_users"))) {
        console.log("  [03] Creating digipog_pool_users table...");
        await run(
            database,
            `CREATE TABLE IF NOT EXISTS "digipog_pool_users" (
                "pool_id" INTEGER NOT NULL,
                "user_id" INTEGER NOT NULL,
                "owner"   INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ("pool_id", "user_id")
            )`
        );
    }
}

// ===========================================================================
// Step 4: Classusers — remove digipogs column, add tags column
// ===========================================================================
async function step04_classusersTable(database) {
    if (!(await tableExists(database, "classusers"))) return;

    const cols = await getColumns(database, "classusers");
    const hasDigipogs = hasColumn(cols, "digiPogs") || hasColumn(cols, "digipogs");
    const hasTags = hasColumn(cols, "tags");

    if (hasDigipogs || !hasTags) {
        console.log("  [04] Restructuring classusers table...");
        await run(database, "BEGIN TRANSACTION");
        try {
            await run(
                database,
                `CREATE TABLE IF NOT EXISTS "classusers_temp" (
                    "classId"     INTEGER NOT NULL,
                    "studentId"   INTEGER NOT NULL,
                    "permissions" INTEGER,
                    "tags"        TEXT
                )`
            );
            await run(
                database,
                `INSERT INTO classusers_temp (classId, studentId, permissions, tags)
                 SELECT classId, studentId, permissions, ${hasTags ? "tags" : "NULL"}
                 FROM classusers`
            );
            await run(database, "DROP TABLE classusers");
            await run(database, "ALTER TABLE classusers_temp RENAME TO classusers");
            await run(database, "COMMIT");
        } catch (err) {
            await run(database, "ROLLBACK").catch(() => {});
            throw err;
        }
    }
}

// ===========================================================================
// Step 5: Custom polls — add allowVoteChanges and allowMultipleResponses
// ===========================================================================
async function step05_customPollsColumns(database) {
    if (!(await tableExists(database, "custom_polls"))) return;

    const cols = await getColumns(database, "custom_polls");
    const hasVoteChanges = hasColumn(cols, "allowVoteChanges");
    const hasMultiRes = hasColumn(cols, "allowMultipleResponses");

    if (!hasVoteChanges || !hasMultiRes) {
        console.log("  [05] Adding missing columns to custom_polls...");
        await run(database, "BEGIN TRANSACTION");
        try {
            await run(
                database,
                `CREATE TABLE IF NOT EXISTS "custom_polls_temp" (
                    "id"                     INTEGER NOT NULL UNIQUE,
                    "owner"                  TEXT,
                    "name"                   TEXT,
                    "prompt"                 TEXT,
                    "answers"                TEXT    NOT NULL,
                    "textRes"                INTEGER NOT NULL DEFAULT 0 CHECK ("textRes" IN (0, 1)),
                    "blind"                  INTEGER NOT NULL DEFAULT 0 CHECK ("blind" IN (0, 1)),
                    "allowVoteChanges"       INTEGER NOT NULL DEFAULT 1 CHECK ("allowVoteChanges" IN (0, 1)),
                    "allowMultipleResponses" INTEGER NOT NULL DEFAULT 0 CHECK ("allowMultipleResponses" IN (0, 1)),
                    "weight"                 INTEGER NOT NULL DEFAULT 1,
                    "public"                 INTEGER NOT NULL DEFAULT 0 CHECK ("public" IN (0, 1)),
                    PRIMARY KEY ("id" AUTOINCREMENT)
                )`
            );
            await run(
                database,
                `INSERT INTO custom_polls_temp (id, owner, name, prompt, answers, textRes, blind, allowVoteChanges, allowMultipleResponses, weight, public)
                 SELECT id, owner, name, prompt, answers, textRes, blind,
                        ${hasVoteChanges ? "allowVoteChanges" : "1"},
                        ${hasMultiRes ? "allowMultipleResponses" : "0"},
                        weight, public
                 FROM custom_polls`
            );
            await run(database, "DROP TABLE custom_polls");
            await run(database, "ALTER TABLE custom_polls_temp RENAME TO custom_polls");
            await run(database, "COMMIT");
        } catch (err) {
            await run(database, "ROLLBACK").catch(() => {});
            throw err;
        }
    }
}

// ===========================================================================
// Step 6: Class permissions table + remove permissions column from classroom
// ===========================================================================
async function step06_classPermissionsTable(database) {
    if (!(await tableExists(database, "class_permissions"))) {
        console.log("  [06] Creating class_permissions table...");
        await run(
            database,
            `CREATE TABLE IF NOT EXISTS "class_permissions" (
                "classId"        INTEGER NOT NULL UNIQUE,
                "manageClass"    INTEGER NOT NULL DEFAULT 4,
                "manageStudents" INTEGER NOT NULL DEFAULT 4,
                "controlPoll"    INTEGER NOT NULL DEFAULT 3,
                "votePoll"       INTEGER NOT NULL DEFAULT 2,
                "seePoll"        INTEGER NOT NULL DEFAULT 1,
                "breakHelp"      INTEGER NOT NULL DEFAULT 3,
                "auxiliary"      INTEGER NOT NULL DEFAULT 3,
                "links"          INTEGER NOT NULL DEFAULT 3,
                "userDefaults"   INTEGER NOT NULL DEFAULT 1
            )`
        );
    }

    // Remove permissions column from classroom if present
    if (await tableExists(database, "classroom")) {
        const cols = await getColumns(database, "classroom");
        if (hasColumn(cols, "permissions")) {
            console.log("  [06] Removing permissions column from classroom...");
            await run(database, "BEGIN TRANSACTION");
            try {
                await run(
                    database,
                    `CREATE TABLE IF NOT EXISTS "classroom_temp" (
                        "id"       INTEGER NOT NULL UNIQUE,
                        "name"     TEXT    NOT NULL,
                        "owner"    INTEGER NOT NULL,
                        "key"      INTEGER NOT NULL,
                        "tags"     TEXT,
                        "settings" TEXT,
                        PRIMARY KEY ("id" AUTOINCREMENT)
                    )`
                );
                await run(
                    database,
                    `INSERT INTO classroom_temp (id, name, owner, key, tags, settings)
                     SELECT id, name, owner, key, tags, settings FROM classroom`
                );
                await run(database, "DROP TABLE classroom");
                await run(database, "ALTER TABLE classroom_temp RENAME TO classroom");
                await run(database, "COMMIT");
            } catch (err) {
                await run(database, "ROLLBACK").catch(() => {});
                throw err;
            }
        }
    }

    // Backfill class_permissions for existing classrooms
    await run(
        database,
        `INSERT OR IGNORE INTO class_permissions (classId)
         SELECT id FROM classroom WHERE id NOT IN (SELECT classId FROM class_permissions)`
    );
}

// ===========================================================================
// Step 7: Drop obsolete tables
// ===========================================================================
async function step07_removeOldTables(database) {
    for (const table of ["lessons", "plugins", "stats"]) {
        if (await tableExists(database, table)) {
            console.log(`  [07] Dropping obsolete table: ${table}`);
            await run(database, `DROP TABLE IF EXISTS ${table}`);
        }
    }
}

// ===========================================================================
// Step 8: Remove duplicate refresh tokens
// ===========================================================================
async function step08_refreshTokensCleanup(database) {
    if (!(await tableExists(database, "refresh_tokens"))) return;
    const cols = await getColumns(database, "refresh_tokens");
    if (!hasColumn(cols, "refresh_token")) return; // Already migrated to token_hash

    console.log("  [08] Cleaning up duplicate refresh tokens...");
    await run(
        database,
        `DELETE FROM refresh_tokens WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM refresh_tokens GROUP BY refresh_token
        )`
    );
}

// ===========================================================================
// Step 9: Unique display name index
// ===========================================================================
async function step09_uniqueDisplayName(database) {
    try {
        await run(database, 'CREATE UNIQUE INDEX IF NOT EXISTS "idx_display_name_unique" ON "users" ("displayName")');
    } catch {
        // Index may already exist
    }
}

// ===========================================================================
// Step 10: Combine IP whitelist/blacklist into ip_access_list
// ===========================================================================
async function step10_combineIpLists(database) {
    const hasWhitelist = await tableExists(database, "ip_whitelist");
    const hasBlacklist = await tableExists(database, "ip_blacklist");
    if (!hasWhitelist && !hasBlacklist) return;

    console.log("  [10] Combining IP lists...");
    await run(
        database,
        `CREATE TABLE IF NOT EXISTS "ip_access_list" (
            "id"           INTEGER NOT NULL UNIQUE,
            "ip"           TEXT    NOT NULL,
            "is_whitelist" INTEGER NOT NULL CHECK ("is_whitelist" IN (0, 1)),
            PRIMARY KEY ("id" AUTOINCREMENT)
        )`
    );

    if (hasWhitelist) {
        await run(database, "INSERT INTO ip_access_list (ip, is_whitelist) SELECT ip, 1 FROM ip_whitelist");
        await run(database, "DROP TABLE IF EXISTS ip_whitelist");
    }
    if (hasBlacklist) {
        await run(database, "INSERT INTO ip_access_list (ip, is_whitelist) SELECT ip, 0 FROM ip_blacklist");
        await run(database, "DROP TABLE IF EXISTS ip_blacklist");
    }
}

// ===========================================================================
// Step 11: Add token_type to refresh_tokens
// ===========================================================================
async function step11_refreshTokenType(database) {
    if (!(await tableExists(database, "refresh_tokens"))) return;
    const cols = await getColumns(database, "refresh_tokens");
    if (hasColumn(cols, "token_type")) return;

    console.log("  [11] Adding token_type to refresh_tokens...");
    try {
        await run(database, "ALTER TABLE refresh_tokens ADD COLUMN token_type TEXT NOT NULL DEFAULT 'auth'");
        await run(database, "UPDATE refresh_tokens SET token_type = 'oauth'");
    } catch {
        // Column may already exist
    }
}

// ===========================================================================
// Step 12: Hash refresh tokens (cleartext → token_hash)
// ===========================================================================
async function step12_hashRefreshTokens(database) {
    if (!(await tableExists(database, "refresh_tokens"))) return;
    const cols = await getColumns(database, "refresh_tokens");

    // If still using cleartext refresh_token column, migrate to token_hash
    if (hasColumn(cols, "refresh_token") && !hasColumn(cols, "token_hash")) {
        console.log("  [12] Migrating refresh_tokens to hashed format...");
        await run(database, "BEGIN TRANSACTION");
        try {
            await run(
                database,
                `CREATE TABLE "refresh_tokens_new" (
                    "user_id"    INTEGER NOT NULL,
                    "token_hash" TEXT    NOT NULL UNIQUE,
                    "exp"        INTEGER NOT NULL,
                    "token_type" TEXT    NOT NULL DEFAULT 'auth'
                )`
            );
            // Existing cleartext tokens can't be migrated — users will need to re-authenticate
            await run(database, "DROP TABLE refresh_tokens");
            await run(database, "ALTER TABLE refresh_tokens_new RENAME TO refresh_tokens");
            await run(database, "COMMIT");
        } catch (err) {
            await run(database, "ROLLBACK").catch(() => {});
            throw err;
        }
    }

    // Ensure indexes exist
    try {
        await run(database, 'CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_type" ON "refresh_tokens" ("token_type")');
        await run(database, 'CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_type" ON "refresh_tokens" ("user_id", "token_type")');
        await run(database, 'CREATE UNIQUE INDEX IF NOT EXISTS "idx_refresh_token_hash_unique" ON "refresh_tokens" ("token_hash")');
    } catch {
        // Indexes may already exist
    }
}

// ===========================================================================
// Step 13: Used authorization codes table
// ===========================================================================
async function step13_usedAuthorizationCodes(database) {
    // Drop and recreate to ensure correct schema
    if (await tableExists(database, "used_authorization_codes")) {
        const cols = await getColumns(database, "used_authorization_codes");
        if (hasColumn(cols, "code_hash") && hasColumn(cols, "used_at") && hasColumn(cols, "expires_at")) {
            return; // Already correct
        }
    }

    console.log("  [13] Creating used_authorization_codes table...");
    await run(database, "DROP TABLE IF EXISTS used_authorization_codes");
    await run(
        database,
        `CREATE TABLE "used_authorization_codes" (
            "code_hash"  TEXT    NOT NULL UNIQUE,
            "used_at"    INTEGER NOT NULL,
            "expires_at" INTEGER NOT NULL
        )`
    );
    await run(database, 'CREATE INDEX IF NOT EXISTS "idx_used_auth_codes_expires" ON "used_authorization_codes" ("expires_at")');
}

// ===========================================================================
// Step 14: Restructure digipog_pool_users (owner/member strings → rows)
// ===========================================================================
async function step14_digipogPoolUsersRestructure(database) {
    if (!(await tableExists(database, "digipog_pool_users"))) return;
    const cols = await getColumns(database, "digipog_pool_users");
    if (!hasColumn(cols, "member")) return; // Already restructured

    console.log("  [14] Restructuring digipog_pool_users...");
    await run(database, "BEGIN TRANSACTION");
    try {
        await run(
            database,
            `CREATE TABLE IF NOT EXISTS "digipog_pool_users_temp" (
                "pool_id" INTEGER NOT NULL,
                "user_id" INTEGER NOT NULL,
                "owner"   INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ("pool_id", "user_id")
            )`
        );

        const rows = await query(database, "SELECT id, owner, member FROM digipog_pool_users");
        for (const row of rows) {
            const userId = row.id;
            for (const [list, ownerFlag] of [
                [row.owner, 1],
                [row.member, 0],
            ]) {
                if (!list) continue;
                for (const rawPoolId of list.split(",")) {
                    const poolId = parseInt(String(rawPoolId).trim(), 10);
                    if (Number.isNaN(poolId)) continue;
                    await run(database, "INSERT OR IGNORE INTO digipog_pool_users_temp (pool_id, user_id, owner) VALUES (?, ?, ?)", [
                        poolId,
                        userId,
                        ownerFlag,
                    ]);
                }
            }
        }

        await run(database, "DROP TABLE IF EXISTS digipog_pool_users");
        await run(database, "ALTER TABLE digipog_pool_users_temp RENAME TO digipog_pool_users");
        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

// ===========================================================================
// Step 15: Hash API keys and PINs
// ===========================================================================
async function step15_hashApiKeysAndPins(database) {
    const version = (await queryOne(database, "PRAGMA user_version")).user_version;
    if (version >= 1) return; // Already hashed

    console.log("  [15] Hashing API keys and PINs...");
    await run(database, "PRAGMA user_version = 1");

    const users = await query(database, "SELECT * FROM users");
    if (users.length === 0) return;

    // Ensure pin column is TEXT (it was originally INTEGER)
    const cols = await getColumns(database, "users");
    const pinCol = cols.find((c) => c.name === "pin");
    const needsRebuild = pinCol && pinCol.type !== "TEXT";

    await run(database, "BEGIN TRANSACTION");
    try {
        await run(
            database,
            `CREATE TABLE IF NOT EXISTS "users_temp" (
                "id"          INTEGER NOT NULL UNIQUE,
                "email"       TEXT    NOT NULL UNIQUE,
                "password"    TEXT,
                "permissions" INTEGER,
                "API"         TEXT    NOT NULL UNIQUE,
                "secret"      TEXT    NOT NULL UNIQUE,
                "digipogs"    INTEGER NOT NULL DEFAULT 0,
                "pin"         TEXT,
                "displayName" TEXT,
                "verified"    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ("id" AUTOINCREMENT)
            )`
        );

        for (const user of users) {
            const hashedAPI = await hash(user.API);
            const hashedPin = user.pin ? await hash(user.pin.toString()) : null;

            await run(
                database,
                `INSERT INTO users_temp (id, email, password, permissions, API, secret, digipogs, pin, displayName, verified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user.id,
                    user.email,
                    user.password,
                    user.permissions,
                    hashedAPI,
                    user.secret,
                    user.digipogs,
                    hashedPin,
                    user.displayName,
                    user.verified,
                ]
            );
        }

        await run(database, "DROP TABLE users");
        await run(database, "ALTER TABLE users_temp RENAME TO users");
        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }

    // Recreate displayName index after table rebuild
    try {
        await run(database, 'CREATE UNIQUE INDEX IF NOT EXISTS "idx_display_name_unique" ON "users" ("displayName")');
    } catch {
        // May already exist
    }

    console.log(`  [15] Hashed API keys and PINs for ${users.length} users.`);
}

// ===========================================================================
// Step 16: Convert ISO 8601 transaction timestamps to unix
// ===========================================================================
async function step16_convertTransactionTimestamps(database) {
    if (!(await tableExists(database, "transactions"))) return;
    const cols = await getColumns(database, "transactions");

    // Only applies if the old from_user column still exists (timestamps may be ISO)
    // Also check if any dates contain 'T' (ISO format indicator)
    const sample = await queryOne(database, "SELECT date FROM transactions WHERE date LIKE '%T%' LIMIT 1");
    if (!sample) return;

    console.log("  [16] Converting transaction timestamps to unix...");
    const transactions = await query(database, "SELECT date FROM transactions WHERE date LIKE '%T%'");
    await run(database, "BEGIN TRANSACTION");
    try {
        for (const tx of transactions) {
            const date = new Date(tx.date);
            const time = date.getTime();
            if (Number.isNaN(time)) continue;
            await run(database, "UPDATE transactions SET date = ? WHERE date = ?", [Math.floor(time), tx.date]);
        }
        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

// ===========================================================================
// Step 17: Lowercase emails and merge duplicate accounts
// ===========================================================================
async function step17_lowercaseEmailsMergeDuplicates(database) {
    const version = (await queryOne(database, "PRAGMA user_version")).user_version;
    if (version >= 2) return;

    console.log("  [17] Lowercasing emails and merging duplicates...");
    await run(database, "BEGIN TRANSACTION");
    try {
        const users = await query(database, "SELECT * FROM users ORDER BY id ASC");
        if (users.length === 0) {
            await run(database, "PRAGMA user_version = 2");
            await run(database, "COMMIT");
            return;
        }

        const emailMap = new Map();
        for (const user of users) {
            if (!user.email) continue;
            const lower = user.email.toLowerCase();
            if (!emailMap.has(lower)) emailMap.set(lower, []);
            emailMap.get(lower).push(user);
        }

        for (const [lowerEmail, group] of emailMap) {
            if (group.length === 1) {
                if (group[0].email !== lowerEmail) {
                    await run(database, "UPDATE users SET email = ? WHERE id = ?", [lowerEmail, group[0].id]);
                }
            } else {
                // Keep oldest (lowest ID), merge digipogs, reassign foreign keys
                const primary = group[0];
                const duplicates = group.slice(1);
                let totalDigipogs = primary.digipogs || 0;

                for (const dup of duplicates) {
                    totalDigipogs += dup.digipogs || 0;
                    await run(database, "UPDATE classroom SET owner = ? WHERE owner = ?", [primary.id, dup.id]);
                    await run(database, "UPDATE classusers SET studentId = ? WHERE studentId = ?", [primary.id, dup.id]);
                    try {
                        await run(database, "UPDATE poll_answers SET userId = ? WHERE userId = ?", [primary.id, dup.id]);
                    } catch {
                        // poll_answers may not exist yet
                    }
                    await run(database, "DELETE FROM users WHERE id = ?", [dup.id]);
                    console.log(`    Merged duplicate user ID ${dup.id} into ${primary.id}`);
                }

                await run(database, "UPDATE users SET email = ?, digipogs = ? WHERE id = ?", [lowerEmail, totalDigipogs, primary.id]);
            }
        }

        await run(database, "PRAGMA user_version = 2");
        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

// ===========================================================================
// Step 18: Restructure transactions (from_user/to_user → from_id/to_id with types)
// ===========================================================================
async function step18_restructureTransactions(database) {
    if (!(await tableExists(database, "transactions"))) return;
    const cols = await getColumns(database, "transactions");

    // Check for old "digipogs" column (very old schema)
    if (hasColumn(cols, "digipogs")) {
        console.log("  [18] Restructuring very old transactions table...");
        await run(database, "DROP TABLE IF EXISTS transactions");
        await run(
            database,
            `CREATE TABLE "transactions" (
                "from_id"   INTEGER NOT NULL,
                "to_id"     INTEGER NOT NULL,
                "from_type" TEXT NOT NULL,
                "to_type"   TEXT NOT NULL,
                "amount"    INTEGER NOT NULL,
                "reason"    TEXT NOT NULL DEFAULT 'None',
                "date"      TEXT NOT NULL
            )`
        );
        return;
    }

    // Check for old from_user column (intermediate schema)
    if (!hasColumn(cols, "from_user")) return; // Already at final schema

    console.log("  [18] Restructuring transactions to from_id/to_id with types...");
    const transactions = await query(database, "SELECT * FROM transactions");
    await run(database, "BEGIN TRANSACTION");
    try {
        await run(
            database,
            `CREATE TABLE "transactions_temp" (
                "from_id"   INTEGER NOT NULL,
                "to_id"     INTEGER NOT NULL,
                "from_type" TEXT NOT NULL,
                "to_type"   TEXT NOT NULL,
                "amount"    INTEGER NOT NULL,
                "reason"    TEXT NOT NULL DEFAULT 'None',
                "date"      TEXT NOT NULL
            )`
        );

        for (const tx of transactions) {
            let fromId, fromType, toId, toType;
            if (!tx.from_user && tx.pool) {
                fromId = tx.pool;
                fromType = "pool";
                toId = tx.to_user;
                toType = "user";
            } else if (!tx.to_user && tx.pool) {
                fromId = tx.from_user;
                fromType = "user";
                toId = tx.pool;
                toType = "pool";
            } else if (tx.from_user && tx.to_user) {
                fromId = tx.from_user;
                fromType = "user";
                toId = tx.to_user;
                toType = "user";
            } else if (!tx.from_user) {
                fromId = 0;
                fromType = "pool";
                toId = tx.to_user;
                toType = "user";
            } else {
                fromId = tx.from_user;
                fromType = "user";
                toId = 0;
                toType = "pool";
            }
            await run(database, "INSERT INTO transactions_temp VALUES (?, ?, ?, ?, ?, ?, ?)", [
                fromId,
                toId,
                fromType,
                toType,
                tx.amount,
                tx.reason,
                tx.date,
            ]);
        }

        await run(database, "DROP TABLE IF EXISTS transactions");
        await run(database, "ALTER TABLE transactions_temp RENAME TO transactions");
        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

// ===========================================================================
// Step 19: Remove digipog pools without owners
// ===========================================================================
async function step19_removeInvalidPools(database) {
    if (!(await tableExists(database, "digipog_pools"))) return;
    if (!(await tableExists(database, "digipog_pool_users"))) return;

    const pools = await query(database, "SELECT id, name FROM digipog_pools");
    const ownedPoolIds = new Set((await query(database, "SELECT pool_id FROM digipog_pool_users WHERE owner = 1")).map((r) => r.pool_id));

    for (const pool of pools) {
        if (!ownedPoolIds.has(pool.id)) {
            console.log(`  [19] Removing invalid pool: ${pool.name} (id: ${pool.id})`);
            await run(database, "DELETE FROM digipog_pools WHERE id = ?", [pool.id]);
            await run(database, "DELETE FROM digipog_pool_users WHERE pool_id = ?", [pool.id]);
        }
    }
}

// ===========================================================================
// Step 20: Restructure poll_history (JSON data → separate columns)
// ===========================================================================
async function step20_updatePollHistory(database) {
    if (!(await tableExists(database, "poll_history"))) return;
    const cols = await getColumns(database, "poll_history");
    if (!hasColumn(cols, "data")) return; // Already restructured

    console.log("  [20] Restructuring poll_history...");
    await run(database, "BEGIN TRANSACTION");
    try {
        const entries = await query(database, "SELECT * FROM poll_history");

        await run(
            database,
            `CREATE TABLE "poll_history_temp" (
                "id"                     INTEGER NOT NULL UNIQUE,
                "class"                  INTEGER NOT NULL,
                "prompt"                 TEXT,
                "responses"              TEXT,
                "allowMultipleResponses" INTEGER NOT NULL DEFAULT 0,
                "blind"                  INTEGER NOT NULL DEFAULT 0,
                "allowTextResponses"     INTEGER NOT NULL DEFAULT 0,
                "createdAt"              INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ("id" AUTOINCREMENT)
            )`
        );

        for (const entry of entries) {
            let data = {};
            try {
                data = JSON.parse(entry.data);
            } catch {
                continue;
            }

            let createdAt = 0;
            if (entry.date) {
                const parsed = new Date(entry.date + "T00:00:00.000Z");
                if (!isNaN(parsed.getTime())) createdAt = parsed.getTime();
            }

            await run(
                database,
                `INSERT INTO poll_history_temp (id, class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    entry.id,
                    entry.class,
                    data.prompt || null,
                    data.responses ? JSON.stringify(data.responses) : null,
                    data.allowMultipleResponses ? 1 : 0,
                    data.blind ? 1 : 0,
                    data.allowTextResponses ? 1 : 0,
                    createdAt,
                ]
            );
        }

        await run(database, "DROP TABLE poll_history");
        await run(database, "ALTER TABLE poll_history_temp RENAME TO poll_history");
        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

// ===========================================================================
// Step 21: Restructure poll_answers (add classId, createdAt, salvage legacy data)
// ===========================================================================
async function step21_updatePollAnswers(database) {
    if (!(await tableExists(database, "poll_answers"))) {
        await run(
            database,
            `CREATE TABLE "poll_answers" (
                "pollId"         INTEGER NOT NULL,
                "classId"        INTEGER NOT NULL,
                "userId"         INTEGER NOT NULL,
                "buttonResponse" TEXT,
                "textResponse"   TEXT,
                "createdAt"      INTEGER,
                PRIMARY KEY ("userId", "pollId")
            )`
        );
        return;
    }

    const cols = await getColumns(database, "poll_answers");
    if (hasColumn(cols, "classId")) return;

    console.log("  [21] Restructuring poll_answers...");
    await run(database, "BEGIN TRANSACTION");
    try {
        await run(database, "DROP TABLE IF EXISTS poll_answers");
        await run(
            database,
            `CREATE TABLE "poll_answers" (
                "pollId"         INTEGER NOT NULL,
                "classId"        INTEGER NOT NULL,
                "userId"         INTEGER NOT NULL,
                "buttonResponse" TEXT,
                "textResponse"   TEXT,
                "createdAt"      INTEGER,
                PRIMARY KEY ("userId", "pollId")
            )`
        );

        // Salvage legacy data from poll_history if it has names/letter/text columns
        if (await tableExists(database, "poll_history")) {
            const histCols = await getColumns(database, "poll_history");
            if (hasColumn(histCols, "names")) {
                const entries = await query(database, "SELECT id, class, names, letter, text FROM poll_history");
                for (const entry of entries) {
                    let names = [],
                        letters = [],
                        texts = [];
                    try {
                        names = entry.names ? JSON.parse(entry.names) : [];
                    } catch {
                        names = [];
                    }
                    try {
                        letters = entry.letter ? JSON.parse(entry.letter) : [];
                    } catch {
                        letters = [];
                    }
                    try {
                        texts = entry.text ? JSON.parse(entry.text) : [];
                    } catch {
                        texts = [];
                    }
                    if (!Array.isArray(names) || names.length === 0) continue;

                    for (let i = 0; i < names.length; i++) {
                        const email = names[i];
                        let buttonResponse = null;
                        const raw = letters[i];
                        if (Array.isArray(raw) && raw.length > 0) buttonResponse = JSON.stringify(raw);
                        else if (typeof raw === "string" && raw !== "") buttonResponse = JSON.stringify([raw]);

                        const rawText = texts[i];
                        const textResponse = typeof rawText === "string" && rawText !== "" ? rawText : null;
                        if (buttonResponse === null && textResponse === null) continue;

                        const user = await queryOne(database, "SELECT id FROM users WHERE email = ?", [email]);
                        if (!user) continue;

                        await run(
                            database,
                            "INSERT OR IGNORE INTO poll_answers (pollId, classId, userId, buttonResponse, textResponse, createdAt) VALUES (?, ?, ?, ?, ?, NULL)",
                            [entry.id, entry.class, user.id, buttonResponse, textResponse]
                        );
                    }
                }

                // Remove legacy columns from poll_history
                await run(
                    database,
                    `CREATE TABLE "poll_history_temp" (
                        "id"                     INTEGER NOT NULL UNIQUE,
                        "class"                  INTEGER NOT NULL,
                        "prompt"                 TEXT,
                        "responses"              TEXT,
                        "allowMultipleResponses" INTEGER NOT NULL DEFAULT 0,
                        "blind"                  INTEGER NOT NULL DEFAULT 0,
                        "allowTextResponses"     INTEGER NOT NULL DEFAULT 0,
                        "createdAt"              INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY ("id" AUTOINCREMENT)
                    )`
                );
                await run(
                    database,
                    `INSERT INTO poll_history_temp (id, class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt)
                     SELECT id, class, prompt, responses, allowMultipleResponses, blind, allowTextResponses, createdAt FROM poll_history`
                );
                await run(database, "DROP TABLE poll_history");
                await run(database, "ALTER TABLE poll_history_temp RENAME TO poll_history");
            }
        }

        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

// ===========================================================================
// Step 22: Create newer tables (inventory, item_registry, trades, notifications, apps)
// ===========================================================================
async function step22_newTables(database) {
    const tables = {
        inventory: `CREATE TABLE IF NOT EXISTS "inventory" (
            "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
            "user_id"  INTEGER NOT NULL,
            "item_id"  INTEGER NOT NULL,
            "quantity" INTEGER NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
            UNIQUE ("user_id", "item_id")
        )`,
        item_registry: `CREATE TABLE IF NOT EXISTS "item_registry" (
            "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
            "name"        TEXT    NOT NULL,
            "description" TEXT,
            "stack_size"  INTEGER NOT NULL DEFAULT 1 CHECK ("stack_size" >= 0),
            "image_url"   TEXT
        )`,
        trades: `CREATE TABLE IF NOT EXISTS "trades" (
            "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
            "from_user"       INTEGER NOT NULL,
            "to_user"         INTEGER NOT NULL,
            "offered_items"   TEXT    NOT NULL,
            "requested_items" TEXT    NOT NULL,
            "status"          TEXT    NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'accepted', 'rejected')),
            "created_at"      TEXT    NOT NULL,
            "updated_at"      TEXT    NOT NULL
        )`,
        notifications: `CREATE TABLE IF NOT EXISTS "notifications" (
            "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
            "user_id"    INTEGER NOT NULL,
            "type"       TEXT    NOT NULL,
            "data"       TEXT,
            "is_read"    INTEGER NOT NULL DEFAULT 0 CHECK ("is_read" IN (0, 1)),
            "created_at" TEXT    NOT NULL DEFAULT (datetime('now'))
        )`,
        apps: `CREATE TABLE IF NOT EXISTS "apps" (
            "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
            "name"            TEXT    NOT NULL UNIQUE,
            "description"     TEXT,
            "owner_user_id"   INTEGER NOT NULL,
            "share_item_id"   INTEGER NOT NULL,
            "pool_id"         INTEGER NOT NULL,
            "api_key_hash"    TEXT    NOT NULL UNIQUE,
            "api_secret_hash" TEXT    NOT NULL
        )`,
    };

    for (const [name, sql] of Object.entries(tables)) {
        if (!(await tableExists(database, name))) {
            console.log(`  [22] Creating ${name} table...`);
            await run(database, sql);
        }
    }

    // Drop old apps table if it has the legacy schema (id, owner, name, key, full)
    if (await tableExists(database, "apps")) {
        const cols = await getColumns(database, "apps");
        if (hasColumn(cols, "full") || hasColumn(cols, "key")) {
            console.log("  [22] Replacing legacy apps table with new schema...");
            await run(database, "DROP TABLE apps");
            await run(database, tables.apps);
        }
    }

    // Notifications index
    try {
        await run(database, 'CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" ("user_id")');
    } catch {
        // May already exist
    }
}

// ===========================================================================
// Step 23: Populate item_registry from CSV
// ===========================================================================
async function step23_populateItemRegistry(database) {
    if (!(await tableExists(database, "item_registry"))) return;

    const count = await queryOne(database, "SELECT COUNT(*) AS count FROM item_registry");
    if (count && count.count > 0) return;

    const csvPath = "./database/items.csv";
    if (!fs.existsSync(csvPath)) {
        console.log("  [23] items.csv not found, skipping item_registry population.");
        return;
    }

    console.log("  [23] Populating item_registry from CSV...");
    const items = await new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(csvPath)
            .on("error", reject)
            .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
            .on("error", reject)
            .on("data", (row) => results.push(row))
            .on("end", () => resolve(results));
    });

    await run(database, "BEGIN TRANSACTION");
    try {
        for (const item of items) {
            const stackSize = parseInt(item.stackSize, 10);
            await run(database, "INSERT OR IGNORE INTO item_registry (name, description, stack_size) VALUES (?, ?, ?)", [
                item.name,
                item.desc,
                Number.isFinite(stackSize) ? stackSize : 1,
            ]);
        }
        await run(database, "COMMIT");
    } catch (err) {
        await run(database, "ROLLBACK").catch(() => {});
        throw err;
    }
}

// ===========================================================================
// Step 24: Add roles and scopes tables, backfill role columns
// ===========================================================================
async function step24_addRolesAndScopes(database) {
    // Create tables
    await run(
        database,
        `CREATE TABLE IF NOT EXISTS "roles" (
            "id"      INTEGER NOT NULL UNIQUE,
            "name"    TEXT    NOT NULL,
            "classId" INTEGER,
            "scopes"  TEXT    NOT NULL DEFAULT '[]',
            PRIMARY KEY ("id" AUTOINCREMENT),
            UNIQUE ("name", "classId")
        )`
    );
    await run(
        database,
        `CREATE TABLE IF NOT EXISTS "user_roles" (
            "userId"  INTEGER NOT NULL,
            "roleId"  INTEGER NOT NULL,
            "classId" INTEGER
        )`
    );
    try {
        await run(
            database,
            'CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_roles_unique" ON "user_roles" ("userId", "roleId", COALESCE("classId", -1))'
        );
    } catch {
        // May already exist
    }

    // Seed default roles if missing
    const existing = new Set((await query(database, "SELECT name FROM roles WHERE classId IS NULL")).map((r) => r.name));
    function buildScopes(roleName) {
        const def = ROLES[roleName];
        if (!def) return "[]";
        return JSON.stringify([...new Set([...def.global, ...def.class])]);
    }
    for (const name of Object.values(ROLE_NAMES)) {
        if (!existing.has(name)) {
            await run(database, 'INSERT INTO "roles" ("name", "classId", "scopes") VALUES (?, NULL, ?)', [name, buildScopes(name)]);
        }
    }

    // Add role column to users if missing
    const userCols = await getColumns(database, "users");
    if (!hasColumn(userCols, "role")) {
        console.log("  [24] Adding role column to users...");
        await run(database, 'ALTER TABLE "users" ADD COLUMN "role" TEXT');
        await run(database, `UPDATE "users" SET "role" = 'Banned' WHERE "permissions" = 0`);
        await run(database, `UPDATE "users" SET "role" = 'Guest' WHERE "permissions" = 1`);
        await run(database, `UPDATE "users" SET "role" = 'Student' WHERE "permissions" = 2`);
        await run(database, `UPDATE "users" SET "role" = 'Mod' WHERE "permissions" = 3`);
        await run(database, `UPDATE "users" SET "role" = 'Teacher' WHERE "permissions" = 4`);
        await run(database, `UPDATE "users" SET "role" = 'Manager' WHERE "permissions" = 5`);
    }

    // Add role column to classusers if missing
    const classCols = await getColumns(database, "classusers");
    if (!hasColumn(classCols, "role")) {
        console.log("  [24] Adding role column to classusers...");
        await run(database, 'ALTER TABLE "classusers" ADD COLUMN "role" TEXT');
        await run(database, `UPDATE "classusers" SET "role" = 'Banned' WHERE "permissions" = 0`);
        await run(database, `UPDATE "classusers" SET "role" = 'Guest' WHERE "permissions" = 1`);
        await run(database, `UPDATE "classusers" SET "role" = 'Student' WHERE "permissions" = 2`);
        await run(database, `UPDATE "classusers" SET "role" = 'Mod' WHERE "permissions" = 3`);
        await run(database, `UPDATE "classusers" SET "role" = 'Teacher' WHERE "permissions" = 4`);
        await run(database, `UPDATE "classusers" SET "role" = 'Manager' WHERE "permissions" = 5`);
    }
}

// ===========================================================================
// Step 25: Set schema version
// ===========================================================================
async function step25_setSchemaVersion(database) {
    if (!(await tableExists(database, "schema_version"))) {
        await run(database, 'CREATE TABLE "schema_version" ("version" INTEGER NOT NULL)');
    }
    const row = await queryOne(database, "SELECT version FROM schema_version LIMIT 1");
    if (row) {
        await run(database, "UPDATE schema_version SET version = 1");
    } else {
        await run(database, "INSERT INTO schema_version (version) VALUES (1)");
    }
    console.log("  [25] Schema version set to 1.");
}
