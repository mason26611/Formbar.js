// 24_multi_role_support.js
// Migrates from single-role-per-student (classusers.role) to multi-role (user_roles table).
// Populates user_roles from existing classusers.role data.
// Adds index on user_roles(classId, userId) for fast lookups.
// Idempotent: safe to run multiple times.

const { dbRun, dbGetAll, dbGet } = require("@modules/database");

module.exports = {
    async run(database) {
        // Add composite index for efficient multi-role lookups
        try {
            await dbRun(
                `CREATE INDEX IF NOT EXISTS "idx_user_roles_class_user" ON "user_roles" ("classId", "userId")`,
                [],
                database
            );
        } catch (e) {
            // Index may already exist
        }

        // Migrate existing classusers.role values into user_roles entries.
        // Only migrate rows that don't already have a corresponding user_roles entry.
        const classUserRows = await dbGetAll(
            `SELECT cu.classId, cu.studentId, cu.role, cu.permissions
             FROM classusers cu
             WHERE cu.role IS NOT NULL AND cu.role != ''`,
            [],
            database
        );

        for (const row of classUserRows) {
            const roleName = row.role;

            // Look up the role ID: first check for a class-specific custom role, then fall back to a global built-in role
            let role = await dbGet(
                `SELECT id FROM roles WHERE name = ? AND classId = ?`,
                [roleName, row.classId],
                database
            );
            if (!role) {
                role = await dbGet(
                    `SELECT id FROM roles WHERE name = ? AND classId IS NULL`,
                    [roleName],
                    database
                );
            }

            if (!role) continue; // Role doesn't exist in DB, skip

            // Check if this assignment already exists
            const existing = await dbGet(
                `SELECT 1 FROM user_roles WHERE userId = ? AND roleId = ? AND classId = ?`,
                [row.studentId, role.id, row.classId],
                database
            );

            if (!existing) {
                await dbRun(
                    `INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)`,
                    [row.studentId, role.id, row.classId],
                    database
                );
            }
        }

        console.log("Migration 24 completed: multi-role support migrated from classusers.role to user_roles.");
    },
};
