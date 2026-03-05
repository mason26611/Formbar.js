const { dbGetAll, dbGet, dbRun } = require("@modules/database");
const { TEACHER_PERMISSIONS } = require("@modules/permissions");
const { getClassIDFromCode } = require("@services/classroom-service");
const { compare } = require("@modules/crypto");
const { rateLimit } = require("@modules/config");

// Rate limiting

const failedAttempts = new Map();

function cleanupOldAttempts() {
    const now = Date.now();
    for (const [userId, data] of failedAttempts.entries()) {
        if (data.attempts) {
            data.attempts = data.attempts.filter((attempt) => now - attempt.timestamp < rateLimit.attemptWindow);
        }
        if ((!data.attempts || data.attempts.length === 0) && (!data.lockedUntil || data.lockedUntil < now)) {
            failedAttempts.delete(userId);
        }
    }
}

setInterval(cleanupOldAttempts, 5 * 60 * 1000);

function checkRateLimit(accountId) {
    const now = Date.now();
    const userAttempts = failedAttempts.get(accountId);

    if (!userAttempts) {
        failedAttempts.set(accountId, { attempts: [], lockedUntil: null });
        return { allowed: true };
    }

    if (userAttempts.lockedUntil && userAttempts.lockedUntil > now) {
        const waitTime = Math.ceil((userAttempts.lockedUntil - now) / 1000);
        return {
            allowed: false,
            message: `Account temporarily locked due to too many failed attempts. Try again in ${waitTime} seconds.`,
            waitTime,
        };
    }

    if (userAttempts.lockedUntil && userAttempts.lockedUntil <= now) {
        userAttempts.lockedUntil = null;
        userAttempts.attempts = [];
    }

    if (userAttempts.attempts.length > 0) {
        const lastAttempt = userAttempts.attempts[userAttempts.attempts.length - 1];
        const timeSinceLastAttempt = now - lastAttempt.timestamp;
        if (timeSinceLastAttempt < rateLimit.minDelayBetweenAttempts) {
            return {
                allowed: false,
                message: "Please wait before attempting another transfer.",
                waitTime: Math.ceil((rateLimit.minDelayBetweenAttempts - timeSinceLastAttempt) / 1000),
            };
        }
    }

    const recentAttempts = userAttempts.attempts.filter((attempt) => now - attempt.timestamp < rateLimit.attemptWindow);
    userAttempts.attempts = recentAttempts;

    const failedCount = recentAttempts.filter((attempt) => !attempt.success).length;

    if (failedCount >= rateLimit.maxAttempts) {
        userAttempts.lockedUntil = now + rateLimit.lockoutDuration;
        const waitTime = Math.ceil(rateLimit.lockoutDuration / 1000);
        return {
            allowed: false,
            message: `Too many failed attempts. Account temporarily locked for ${Math.ceil(waitTime / 60)} minutes.`,
            waitTime,
        };
    }

    return { allowed: true };
}

function recordAttempt(accountId, success) {
    const now = Date.now();
    const userAttempts = failedAttempts.get(accountId) || { attempts: [], lockedUntil: null };
    userAttempts.attempts.push({ timestamp: now, success });
    if (success) {
        userAttempts.attempts = userAttempts.attempts.filter((attempt) => attempt.success);
        userAttempts.lockedUntil = null;
    }
    failedAttempts.set(accountId, userAttempts);
}

// Pool helpers

async function getPoolsForUser(userId, database) {
    return dbGetAll("SELECT pool_id, owner FROM digipog_pool_users WHERE user_id = ?", [userId], database);
}

async function getUsersForPool(poolId, database) {
    return dbGetAll("SELECT user_id, owner FROM digipog_pool_users WHERE pool_id = ?", [poolId], database);
}

async function isUserInPool(userId, poolId, database) {
    const row = await dbGet("SELECT 1 FROM digipog_pool_users WHERE pool_id = ? AND user_id = ? LIMIT 1", [poolId, userId], database);
    return !!row;
}

async function isUserOwner(userId, poolId, database) {
    const row = await dbGet("SELECT owner FROM digipog_pool_users WHERE pool_id = ? AND user_id = ? LIMIT 1", [poolId, userId], database);
    return !!(row && row.owner);
}

async function isPoolOwnedByUser(poolId, userId, database) {
    return isUserOwner(userId, poolId, database);
}

async function addUserToPool(poolId, userId, ownerFlag = 0, database) {
    return dbRun(
        "INSERT OR REPLACE INTO digipog_pool_users (pool_id, user_id, owner) VALUES (?, ?, ?)",

        [poolId, userId, ownerFlag ? 1 : 0],
        database
    );
}

async function removeUserFromPool(poolId, userId, database) {
    if (await isUserOwner(userId, poolId, database)) {
        const poolUsers = await getUsersForPool(poolId, database);
        const otherOwners = poolUsers.filter((poolUser) => poolUser.user_id !== userId && poolUser.owner);
        if (otherOwners.length === 0) {
            await dbRun("DELETE FROM digipog_pools WHERE id = ?", [poolId], database);
            await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [poolId], database);
            return;
        }
    }
    await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ? AND user_id = ?", [poolId, userId], database);
}

async function setUserOwnerFlag(poolId, userId, ownerFlag, database) {
    return dbRun("UPDATE digipog_pool_users SET owner = ? WHERE pool_id = ? AND user_id = ?", [ownerFlag ? 1 : 0, poolId, userId], database);
}

// Transactions

async function getUserTransactions(userId) {
    const pools = await dbGetAll("SELECT pool_id FROM digipog_pool_users WHERE user_id = ?", [userId]);
    const poolIds = pools.map((pool) => pool.pool_id);

    // Build the query dynamically based on whether there are pools
    let query = "SELECT * FROM transactions WHERE (from_id = ? AND from_type = 'user') OR (to_id = ? AND to_type = 'user')";
    let params = [userId, userId];

    if (poolIds.length > 0) {
        const placeholders = poolIds.map(() => "?").join(",");
        query += ` OR (from_id IN (${placeholders}) AND from_type = 'pool') OR (to_id IN (${placeholders}) AND to_type = 'pool')`;
        params.push(...poolIds, ...poolIds);
    }

    query += " ORDER BY date DESC";

    const transactions = await dbGetAll(query, params);
    return transactions;
}

// Award / Transfer

async function awardDigipogs(awardData, user) {
    try {
        const from = user?.userId ?? user?.id;
        const amount = Math.ceil(Number(awardData?.amount));
        const reason = awardData?.reason || "Awarded";

        let to = awardData?.to;
        let deprecatedFormatUsed = false;
        if (typeof to === "string" || typeof to === "number") {
            // Old API: `to` was a plain user ID, normalize to object format
            to = { id: to, type: "user" };
            deprecatedFormatUsed = true;
        } else if (!to && (awardData?.userId || awardData?.studentId)) {
            // Legacy HTTP payloads sent `userId`/`studentId` directly
            to = { id: awardData.userId || awardData.studentId, type: "user" };
            deprecatedFormatUsed = true;
        }

        if (!to || typeof to !== "object") {
            return { success: false, message: "Missing recipient identifier." };
        }

        to = { ...to };

        if (!to.id && (to.userId || to.studentId)) {
            // Legacy object shape: `{ to: { userId } }`
            to.id = to.userId || to.studentId;
            if (!to.type) to.type = "user";
            deprecatedFormatUsed = true;
        }
        if (!to.type) {
            to.type = "user";
            deprecatedFormatUsed = true;
        }

        if (!from || Number.isNaN(amount)) {
            return { success: false, message: "Missing required fields." };
        } else if (to.type !== "user" && to.type !== "pool" && to.type !== "class") {
            return { success: false, message: "Invalid recipient type." };
        } else if (amount <= 0) {
            return { success: false, message: "Amount must be greater than zero." };
        } else if (to.type !== "class" && !to.id) {
            return { success: false, message: "Missing recipient identifier." };
        }

        const accountId = `award-${from}`;
        const fail = (message) => {
            recordAttempt(accountId, false);
            return { success: false, message };
        };

        const rateLimitCheck = checkRateLimit(accountId);
        if (!rateLimitCheck.allowed) {
            return { success: false, message: rateLimitCheck.message, rateLimited: true, waitTime: rateLimitCheck.waitTime };
        }

        const fromUser = await dbGet("SELECT email, permissions FROM users WHERE id = ?", [from]);
        if (!fromUser || !fromUser.email) {
            return fail("Sender account not found.");
        }

        if (to.type === "class") {
            if (to.code) {
                to.id = await getClassIDFromCode(to.code);
                if (!to.id) {
                    return fail("Invalid class code.");
                }
            } else if (!to.id) {
                return fail("Missing class identifier.");
            }

            const classInfo = await dbGet("SELECT c.id, c.owner FROM classroom c WHERE c.id = ?", [to.id]);
            if (!classInfo) {
                return fail("Recipient class not found.");
            }

            let classPermissions = 0;
            if (classInfo.owner === from) {
                classPermissions = TEACHER_PERMISSIONS;
            } else {
                const permRow = await dbGet("SELECT permissions FROM classusers WHERE classId = ? AND studentId = ?", [to.id, from]);
                classPermissions = permRow ? permRow.permissions : 0;
            }

            if (classPermissions < TEACHER_PERMISSIONS && fromUser.permissions < TEACHER_PERMISSIONS) {
                return fail("Sender does not have permission to award to this class.");
            }

            await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id IN (SELECT studentId FROM classusers WHERE classId = ?) OR id = ?", [
                amount,
                to.id,
                classInfo.owner,
            ]);
        } else if (to.type === "pool") {
            if (!to.id) {
                return fail("Missing pool identifier.");
            }
            if (fromUser.permissions < TEACHER_PERMISSIONS) {
                return fail("Sender does not have permission to award to pools.");
            }
            const poolInfo = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [to.id]);
            if (!poolInfo) {
                return fail("Recipient pool not found.");
            }
            await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [amount, to.id]);
        } else if (to.type === "user") {
            const toUser = await dbGet("SELECT id FROM users WHERE id = ?", [to.id]);
            if (!toUser) {
                return fail("Recipient account not found.");
            }

            if (fromUser.permissions < TEACHER_PERMISSIONS) {
                const hasPermission = await dbGet(
                    "SELECT 1 FROM classusers cu1 INNER JOIN classroom c ON c.id = cu1.classId WHERE cu1.studentId = ? AND (cu1.classId IN (SELECT classId FROM classusers cu2 WHERE cu2.studentId = ? AND cu2.permissions >= ?) OR c.owner = ?)",

                    [to.id, from, TEACHER_PERMISSIONS, from]
                );
                if (!hasPermission) {
                    return fail("Sender does not have permission to award to this user.");
                }
            }

            await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [amount, to.id]);
        }

        try {
            await dbRun("INSERT INTO transactions (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                from,
                to.id,
                "award",
                to.type,
                amount,
                reason,
                Date.now(),
            ]);
        } catch (err) {
            return { success: true, message: "Award succeeded, but failed to log transaction." };
        }

        recordAttempt(accountId, true);
        const successMessage = deprecatedFormatUsed
            ? "Digipogs awarded successfully. Warning: Deprecated award format used. See documentation for updated usage."
            : "Digipogs awarded successfully.";
        return {
            success: true,
            message: successMessage,
        };
    } catch (err) {
        return { success: false, message: "Database error." };
    }
}

async function transferDigipogs(transferData) {
    try {
        const { pin, reason = "", pool } = transferData;
        let from = transferData.from;
        let to = transferData.to;
        const amount = Math.floor(transferData.amount);

        let deprecatedFormatUsed = false;
        if (typeof from === "string" || typeof from === "number") {
            // Old API: `from`/`to` were plain user IDs; `pool` flag indicated a pool recipient
            if (typeof to !== "string" && typeof to !== "number") {
                return { success: false, message: "Missing recipient identifier." };
            }
            from = { id: from, type: "user" };
            to = { id: pool ? pool : to, type: pool ? "pool" : "user" };
            deprecatedFormatUsed = true;
        } else if (!from || !from.id) {
            return { success: false, message: "Missing sender identifier." };
        }
        if (!from.type) from.type = "user";
        // Normalize `to` independently: if it's still a primitive at this point
        // (e.g. the caller passed an object `from` but a raw id for `to`), wrap it
        // rather than letting `to.type` throw on a non-object.
        if (typeof to === "string" || typeof to === "number") {
            to = { id: to, type: pool ? "pool" : "user" };
        } else if (!to || typeof to !== "object") {
            return { success: false, message: "Missing recipient identifier." };
        }
        if (!to.type) to.type = "user";

        if (!from || !from.id || !to || !to.id || !amount || reason === undefined || !pin) {
            return { success: false, message: "Missing required fields." };
        } else if (amount <= 0) {
            return { success: false, message: "Amount must be greater than zero." };
        } else if (from.type === to.type && from.id === to.id) {
            return { success: false, message: "Cannot transfer to the same account." };
        } else if ((from.type !== "user" && from.type !== "pool") || (to.type !== "user" && to.type !== "pool")) {
            return { success: false, message: "Invalid sender or recipient type." };
        }

        const accountId = `${from.type}-${from.id}`;
        const rateLimitCheck = checkRateLimit(accountId);
        if (!rateLimitCheck.allowed) {
            return { success: false, message: rateLimitCheck.message, rateLimited: true, waitTime: rateLimitCheck.waitTime };
        }

        let fromAccount;
        if (from.type === "user") {
            fromAccount = await dbGet("SELECT * FROM users WHERE id = ?", [from.id]);
            if (!fromAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Sender account not found." };
            }
        } else {
            fromAccount = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [from.id]);
            const poolUser = await dbGet("SELECT user_id FROM digipog_pool_users WHERE pool_id = ? AND owner = 1", [from.id]);
            if (!fromAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Sender pool not found." };
            }
            const poolOwner = await dbGet("SELECT pin FROM users WHERE id = ?", [poolUser.user_id]);
            fromAccount.pin = poolOwner.pin;
        }

        if (!fromAccount.pin) {
            recordAttempt(accountId, false);
            return { success: false, message: "Account PIN not configured." };
        }

        const isPinValid = await compare(String(pin), fromAccount.pin);
        if (!isPinValid) {
            recordAttempt(accountId, false);
            return { success: false, message: "Invalid PIN." };
        }

        const fromBalance = from.type === "user" ? fromAccount.digipogs : fromAccount.amount;
        if (fromBalance < amount) {
            recordAttempt(accountId, false);
            return { success: false, message: "Insufficient funds." };
        }

        const taxedAmount = Math.floor(amount * 0.9) > 1 ? Math.floor(amount * 0.9) : 1;
        const taxAmount = amount - taxedAmount;

        let toAccount;
        if (to.type === "user") {
            toAccount = await dbGet("SELECT * FROM users WHERE id = ?", [to.id]);
            if (!toAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Recipient account not found." };
            }
        } else {
            toAccount = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [to.id]);
            if (!toAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Recipient pool not found." };
            }
        }

        try {
            await dbRun("BEGIN TRANSACTION");
            if (from.type === "user") {
                await dbRun("UPDATE users SET digipogs = digipogs - ? WHERE id = ?", [amount, from.id]);
            } else {
                await dbRun("UPDATE digipog_pools SET amount = amount - ? WHERE id = ?", [amount, from.id]);
            }
            if (to.type === "user") {
                await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [taxedAmount, to.id]);
            } else {
                await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [taxedAmount, to.id]);
            }
            const devPool = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [0]);
            if (devPool) await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [taxAmount, 0]);
            await dbRun("COMMIT");
        } catch (err) {
            try {
                await dbRun("ROLLBACK");
            } catch (rollbackErr) {}
            recordAttempt(accountId, false);
            return { success: false, message: "Transfer failed due to database error." };
        }

        try {
            await dbRun("INSERT INTO transactions (from_id, from_type, to_id, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                from.id,
                from.type,
                to.id,
                to.type,
                amount,
                reason,
                Date.now(),
            ]);
        } catch (err) {}

        recordAttempt(accountId, true);
        return {
            success: true,
            message: `Transfer successful. ${deprecatedFormatUsed ? "Warning: Deprecated transfer format used. See documentation for updated usage." : ""}`,
        };
    } catch (err) {
        return { success: false, message: "Database error." };
    }
}

module.exports = {
    // Transactions
    getUserTransactions,
    awardDigipogs,
    transferDigipogs,
    // Pool helpers
    getPoolsForUser,
    getUsersForPool,
    isUserInPool,
    isUserOwner,
    isPoolOwnedByUser,
    addUserToPool,
    removeUserFromPool,
    setUserOwnerFlag,
};
