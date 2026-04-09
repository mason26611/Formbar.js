// 23_add_roles_and_scopes.js
// Adds the roles/user_roles tables and role columns to users/classusers.
// Idempotent: safe to run multiple times on the same database.

const { dbRun, dbGetAll } = require("@modules/database");
const { ROLES, ROLE_NAMES } = require("@modules/roles");

/**
 * Builds the seed scopes JSON string for a role by combining its global and class scopes.
 * Deduplicates entries via Set.
 */
function buildScopesJson(roleName) {
    const roleDefinition = ROLES[roleName];
    if (!roleDefinition) return "[]";
    const allScopes = [...new Set([...roleDefinition.global, ...roleDefinition.class])];
    return JSON.stringify(allScopes);
}

module.exports = {
    async run(database) {
        // Create roles table if it doesn't exist
        await dbRun(
            `CREATE TABLE IF NOT EXISTS "roles" (
                "id"      INTEGER NOT NULL UNIQUE,
                "name"    TEXT NOT NULL,
                "classId" INTEGER,
                "scopes"  TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY ("id" AUTOINCREMENT),
                UNIQUE ("name", "classId")
            )`,
            [],
            database
        );

        // Create user_roles table if it doesn't exist
        await dbRun(
            `CREATE TABLE IF NOT EXISTS "user_roles" (
                "userId"  INTEGER NOT NULL,
                "roleId"  INTEGER NOT NULL,
                "classId" INTEGER
            )`,
            [],
            database
        );

        // Create unique index for user_roles (handles NULL classId)
        try {
            await dbRun(
                `CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_roles_unique" ON "user_roles" ("userId", "roleId", COALESCE("classId", -1))`,
                [],
                database
            );
        } catch (e) {
            // Index may already exist
        }

        // Seed default global roles (upsert-safe via checking existence)
        const existingRoles = await dbGetAll("SELECT name FROM roles WHERE classId IS NULL", [], database);
        const existingNames = new Set(existingRoles.map((r) => r.name));

        const defaultRoles = Object.values(ROLE_NAMES).map((name) => ({
            name,
            scopes: buildScopesJson(name),
        }));

        for (const role of defaultRoles) {
            if (!existingNames.has(role.name)) {
                await dbRun(`INSERT INTO "roles" ("name", "classId", "scopes") VALUES (?, NULL, ?)`, [role.name, role.scopes], database);
            }
        }

        // Add role column to users table if it doesn't exist
        const usersColumns = await dbGetAll("PRAGMA table_info(users)", [], database);
        const hasUserPermissionsColumn = usersColumns.some((col) => col.name === "permissions");
        if (!usersColumns.some((col) => col.name === "role")) {
            await dbRun(`ALTER TABLE "users" ADD COLUMN "role" TEXT`, [], database);

            // Backfill users.role from existing numeric permissions
            if (hasUserPermissionsColumn) {
                await dbRun(`UPDATE "users" SET "role" = 'Banned' WHERE "permissions" = 0`, [], database);
                await dbRun(`UPDATE "users" SET "role" = 'Guest' WHERE "permissions" = 1`, [], database);
                await dbRun(`UPDATE "users" SET "role" = 'Student' WHERE "permissions" = 2`, [], database);
                await dbRun(`UPDATE "users" SET "role" = 'Mod' WHERE "permissions" = 3`, [], database);
                await dbRun(`UPDATE "users" SET "role" = 'Teacher' WHERE "permissions" = 4`, [], database);
                await dbRun(`UPDATE "users" SET "role" = 'Manager' WHERE "permissions" = 5`, [], database);
            }
        }

        // Add role column to classusers table if it doesn't exist
        const classusersColumns = await dbGetAll("PRAGMA table_info(classusers)", [], database);
        const hasClassUserPermissionsColumn = classusersColumns.some((col) => col.name === "permissions");
        if (!classusersColumns.some((col) => col.name === "role")) {
            await dbRun(`ALTER TABLE "classusers" ADD COLUMN "role" TEXT`, [], database);

            // Backfill classusers.role from existing numeric permissions
            if (hasClassUserPermissionsColumn) {
                await dbRun(`UPDATE "classusers" SET "role" = 'Banned' WHERE "permissions" = 0`, [], database);
                await dbRun(`UPDATE "classusers" SET "role" = 'Guest' WHERE "permissions" = 1`, [], database);
                await dbRun(`UPDATE "classusers" SET "role" = 'Student' WHERE "permissions" = 2`, [], database);
                await dbRun(`UPDATE "classusers" SET "role" = 'Mod' WHERE "permissions" = 3`, [], database);
                await dbRun(`UPDATE "classusers" SET "role" = 'Teacher' WHERE "permissions" = 4`, [], database);
                await dbRun(`UPDATE "classusers" SET "role" = 'Manager' WHERE "permissions" = 5`, [], database);
            }
        }

        console.log("Migration 23 completed: roles tables created and role columns added.");
    },
};
