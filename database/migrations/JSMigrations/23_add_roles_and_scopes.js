// 23_add_roles_and_scopes.js
// Adds the roles/user_roles tables and role columns to users/classusers.
// Idempotent: safe to run multiple times on the same database.

const { dbRun, dbGetAll } = require("@modules/database");

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

        const defaultRoles = [
            { name: "Banned", scopes: "[]" },
            { name: "Guest", scopes: '["class.poll.read","class.digipogs.award"]' },
            { name: "Student", scopes: '["class.poll.read","class.poll.vote","class.break.request","class.help.request","class.digipogs.award"]' },
            {
                name: "Mod",
                scopes: '["class.poll.read","class.poll.vote","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.break.request","class.break.approve","class.help.request","class.help.approve","class.auxiliary.control","class.games.access","class.tags.manage","class.digipogs.award"]',
            },
            {
                name: "Teacher",
                scopes: '["global.class.create","global.class.delete","global.digipogs.award","class.poll.read","class.poll.vote","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.students.read","class.students.kick","class.students.ban","class.students.perm_change","class.session.start","class.session.end","class.session.rename","class.session.settings","class.session.regenerate_code","class.break.request","class.break.approve","class.help.request","class.help.approve","class.timer.control","class.auxiliary.control","class.games.access","class.tags.manage","class.digipogs.award"]',
            },
            {
                name: "Manager",
                scopes: '["global.system.admin","global.users.manage","global.class.create","global.class.delete","global.digipogs.award","class.poll.read","class.poll.vote","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.students.read","class.students.kick","class.students.ban","class.students.perm_change","class.session.start","class.session.end","class.session.rename","class.session.settings","class.session.regenerate_code","class.break.request","class.break.approve","class.help.request","class.help.approve","class.timer.control","class.auxiliary.control","class.games.access","class.tags.manage","class.digipogs.award"]',
            },
        ];

        for (const role of defaultRoles) {
            if (!existingNames.has(role.name)) {
                await dbRun(`INSERT INTO "roles" ("name", "classId", "scopes") VALUES (?, NULL, ?)`, [role.name, role.scopes], database);
            }
        }

        // Add role column to users table if it doesn't exist
        const usersColumns = await dbGetAll("PRAGMA table_info(users)", [], database);
        if (!usersColumns.some((col) => col.name === "role")) {
            await dbRun(`ALTER TABLE "users" ADD COLUMN "role" TEXT`, [], database);

            // Backfill users.role from existing numeric permissions
            await dbRun(`UPDATE "users" SET "role" = 'Banned' WHERE "permissions" = 0`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Guest' WHERE "permissions" = 1`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Student' WHERE "permissions" = 2`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Mod' WHERE "permissions" = 3`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Teacher' WHERE "permissions" = 4`, [], database);
            await dbRun(`UPDATE "users" SET "role" = 'Manager' WHERE "permissions" = 5`, [], database);
        }

        // Add role column to classusers table if it doesn't exist
        const classusersColumns = await dbGetAll("PRAGMA table_info(classusers)", [], database);
        if (!classusersColumns.some((col) => col.name === "role")) {
            await dbRun(`ALTER TABLE "classusers" ADD COLUMN "role" TEXT`, [], database);

            // Backfill classusers.role from existing numeric permissions
            await dbRun(`UPDATE "classusers" SET "role" = 'Banned' WHERE "permissions" = 0`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Guest' WHERE "permissions" = 1`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Student' WHERE "permissions" = 2`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Mod' WHERE "permissions" = 3`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Teacher' WHERE "permissions" = 4`, [], database);
            await dbRun(`UPDATE "classusers" SET "role" = 'Manager' WHERE "permissions" = 5`, [], database);
        }

        console.log("Migration 23 completed: roles tables created and role columns added.");
    },
};
