// 12_lowercase_emails_merge_duplicates.ts
// This migration lowercases all email addresses in the users table
// and deletes duplicate accounts, keeping only the oldest account for each email

import sqlite3 = require("sqlite3");

const { dbRun, dbGetAll, dbGet } = require("../../../modules/database") as {
    dbRun: (query: string, params: unknown[], db: sqlite3.Database) => Promise<number>;
    dbGetAll: <T>(query: string, params: unknown[], db: sqlite3.Database) => Promise<T[]>;
    dbGet: <T>(query: string, params: unknown[], db: sqlite3.Database) => Promise<T | undefined>;
};

interface UserVersionRow {
    user_version: number;
}

interface UserRow {
    id: number;
    email: string | null;
    digipogs: number;
}

module.exports = {
    async run(database: sqlite3.Database): Promise<void> {
        console.log("Starting email lowercase and duplicate merge migration...");

        // Check if we've already migrated by checking the user_version
        const versionRow = await dbGet<UserVersionRow>("PRAGMA user_version", [], database);
        const version = versionRow?.user_version ?? 0;
        if (version >= 2) {
            throw new Error("ALREADY_DONE"); // Migration already completed
        }

        await dbRun("BEGIN TRANSACTION", [], database);
        try {
            // Get all users
            const users = await dbGetAll<UserRow>("SELECT * FROM users ORDER BY id ASC", [], database);

            if (users.length === 0) {
                console.log("No users found, skipping migration");
                await dbRun("PRAGMA user_version = 2", [], database);
                await dbRun("COMMIT", [], database);
                return;
            }

            // Track which emails are duplicates
            const emailMap = new Map<string, UserRow[]>(); // lowercase email -> array of user objects

            // First pass: lowercase all emails and identify duplicates
            for (const user of users) {
                if (!user.email) {
                    continue; // Skip
                }

                const lowercaseEmail = user.email.toLowerCase();

                if (!emailMap.has(lowercaseEmail)) {
                    emailMap.set(lowercaseEmail, []);
                }
                emailMap.get(lowercaseEmail)!.push(user);
            }

            // Process each email group
            for (const [lowercaseEmail, userGroup] of emailMap) {
                if (userGroup.length === 1) {
                    // No duplicates, just lowercase the email
                    const user = userGroup[0];
                    if (user.email !== lowercaseEmail) {
                        await dbRun("UPDATE users SET email = ? WHERE id = ?", [lowercaseEmail, user.id], database);
                    }
                } else {
                    // Duplicates found - keep oldest, delete the rest
                    console.log(`Found ${userGroup.length} accounts with email: ${lowercaseEmail}`);

                    // Keep the oldest account (lowest ID)
                    const primaryUser = userGroup[0];
                    const duplicateUsers = userGroup.slice(1);

                    console.log(`  Keeping user ID ${primaryUser.id}, deleting ${duplicateUsers.length} duplicate(s)`);

                    // Calculate total digipogs from all accounts
                    let totalDigipogs = primaryUser.digipogs || 0;
                    for (const dupUser of duplicateUsers) {
                        totalDigipogs += dupUser.digipogs || 0;
                    }

                    // Update all foreign key references and delete duplicate users FIRST
                    for (const dupUser of duplicateUsers) {
                        const dupId = dupUser.id;
                        const primaryId = primaryUser.id;

                        // Update classroom (owner)
                        await dbRun("UPDATE classroom SET owner = ? WHERE owner = ?", [primaryId, dupId], database);

                        // Update classusers (studentId)
                        await dbRun("UPDATE classusers SET studentId = ? WHERE studentId = ?", [primaryId, dupId], database);

                        // Update poll_answers (userId)
                        await dbRun("UPDATE poll_answers SET userId = ? WHERE userId = ?", [primaryId, dupId], database);

                        // Delete the duplicate user
                        await dbRun("DELETE FROM users WHERE id = ?", [dupId], database);

                        console.log(`  Deleted duplicate user ID ${dupId}`);
                    }

                    // Now update primary user email to lowercase and combined digipogs (after duplicates are gone)
                    await dbRun("UPDATE users SET email = ?, digipogs = ? WHERE id = ?", [lowercaseEmail, totalDigipogs, primaryUser.id], database);
                }
            }

            // Update version to mark migration as complete
            await dbRun("PRAGMA user_version = 2", [], database);

            const duplicateCount = Array.from(emailMap.values()).reduce((count, group) => count + (group.length > 1 ? group.length - 1 : 0), 0);
            console.log(`Migration complete. Processed ${users.length} users, deleted ${duplicateCount} duplicate accounts.`);
        } catch (err) {
            await dbRun("ROLLBACK", [], database);
            throw err;
        }
        await dbRun("COMMIT", [], database);
    },
};
