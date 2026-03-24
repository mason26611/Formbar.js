import type { AuthenticatedRequest } from "../types/api";
import type {
    UserRow,
    DigipogPoolRow,
    DigipogPoolUserRow,
    TransactionRow,
    ClassroomRow,
    ClassUserRow,
} from "../types/database";

const { dbGetAll: _dbGetAll, dbGet: _dbGet, dbRun: _dbRun } = require("@modules/database");
const { TEACHER_PERMISSIONS } = require("@modules/permissions") as { TEACHER_PERMISSIONS: number };
const { getClassIDFromCode } = require("@services/classroom-service") as {
    getClassIDFromCode: (code: string) => number | Promise<number | null>;
};
const { compare } = require("@modules/crypto") as { compare: (text: string, hash: string) => Promise<boolean> };
const { rateLimit } = require("@modules/config") as {
    rateLimit: { maxAttempts: number; lockoutDuration: number; attemptWindow: number; minDelayBetweenAttempts: number };
};
const AppError = require("@errors/app-error") as new (
    message: string,
    options?: { statusCode?: number; event?: string; reason?: string; error?: string }
) => Error;

const dbGet = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T | undefined> => _dbGet(query, params);
const dbGetAll = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => _dbGetAll(query, params);
const dbRun = (query: string, params?: unknown[]): Promise<number> => _dbRun(query, params);

// --- Interfaces ---

interface RateLimitAttempt {
    timestamp: number;
    success: boolean;
}

interface RateLimitData {
    attempts: RateLimitAttempt[];
    lockedUntil: number | null;
}

interface RateLimitResult {
    allowed: boolean;
    message?: string;
    waitTime?: number;
}

interface TransactionParty {
    id: number;
    type: string;
    username: string | null;
}

interface EnrichedTransaction {
    amount: number;
    reason: string;
    date: string;
    from: TransactionParty;
    to: TransactionParty;
}

// Wider type for transactions that include "award" and "class" entity types beyond the base schema
interface ExtendedTransactionRow {
    from_id: number;
    to_id: number;
    from_type: string;
    to_type: string;
    amount: number;
    reason: string;
    date: string;
}

interface OperationResult {
    success: boolean;
    message: string;
    rateLimited?: boolean;
    waitTime?: number;
}

interface TransferParty {
    id: number | string;
    type: "user" | "pool";
}

interface TransferData {
    from: TransferParty | number | string;
    to: TransferParty | number | string;
    amount: number;
    pin: string | number;
    reason?: string;
    pool?: number | string;
}

interface AwardRecipient {
    id?: number | string;
    type?: "user" | "pool" | "class";
    userId?: number | string;
    studentId?: number | string;
    code?: string;
}

interface AwardData {
    amount: number | string;
    to?: AwardRecipient | number | string;
    reason?: string;
    userId?: number | string;
    studentId?: number | string;
}

interface AwardUser {
    userId?: number;
    id?: number;
}

interface EntityInfo {
    id: number;
    username: string;
}

interface CountRow {
    count: number;
}

interface UserDisplayRow {
    id: number;
    displayName: string | null;
    email: string | null;
}

interface PoolNameRow {
    id: number;
    name: string | null;
}

interface ClassNameRow {
    id: number;
    name: string | null;
}

interface UserPermRow {
    email: string;
    permissions: number;
}

interface ClassOwnerRow {
    id: number;
    owner: number;
}

interface PoolUserRow {
    user_id: number;
}

interface UserPinRow {
    pin: string | null;
}

interface UserIdRow {
    id: number;
}

interface PermRow {
    permissions: number;
}

interface OneRow {
    1: number;
}

interface OwnerRow {
    owner: number;
}

interface CreatePoolParams {
    name: string;
    description?: string;
    ownerId: number;
}

interface AddMemberParams {
    actingUserId: number;
    poolId: number;
    userId: number;
}

interface RemoveMemberParams {
    actingUserId: number;
    poolId: number;
    userId: number;
}

interface PayoutPoolParams {
    actingUserId: number;
    poolId: number;
}

// --- Rate limiting ---

const failedAttempts: Map<string, RateLimitData> = new Map();

function cleanupOldAttempts(): void {
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

const cleanupInterval: NodeJS.Timeout = setInterval(cleanupOldAttempts, 5 * 60 * 1000);
if (typeof cleanupInterval.unref === "function") {
    cleanupInterval.unref();
}

function checkRateLimit(accountId: string): RateLimitResult {
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

function recordAttempt(accountId: string, success: boolean): void {
    const now = Date.now();
    const userAttempts = failedAttempts.get(accountId) || { attempts: [], lockedUntil: null };
    userAttempts.attempts.push({ timestamp: now, success });
    if (success) {
        userAttempts.attempts = userAttempts.attempts.filter((attempt) => attempt.success);
        userAttempts.lockedUntil = null;
    }
    failedAttempts.set(accountId, userAttempts);
}

// --- Pool helpers ---

async function createPool({ name, description = "", ownerId }: CreatePoolParams): Promise<number> {
    const poolId: number = await dbRun("INSERT INTO digipog_pools (name, description, amount) VALUES (?, ?, ?)", [name, description, 0]);
    await addUserToPool(poolId, ownerId, 1);
    return poolId;
}

async function deletePool(poolId: number): Promise<void> {
    await dbRun("DELETE FROM digipog_pools WHERE id = ?", [poolId]);
    await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [poolId]);
}

async function getPoolsForUser(userId: number): Promise<DigipogPoolUserRow[]> {
    return dbGetAll<DigipogPoolUserRow>("SELECT pool_id, owner FROM digipog_pool_users WHERE user_id = ?", [userId]);
}

async function getPoolById(poolId: number): Promise<DigipogPoolRow | undefined> {
    return dbGet<DigipogPoolRow>("SELECT * FROM digipog_pools WHERE id = ?", [poolId]);
}

async function getPoolsForUserPaginated(
    userId: number,
    limit: number = 20,
    offset: number = 0
): Promise<{ pools: DigipogPoolUserRow[]; total: number }> {
    const totalRow = await dbGet<CountRow>("SELECT COUNT(*) AS count FROM digipog_pool_users WHERE user_id = ?", [userId]);
    const pools = await dbGetAll<DigipogPoolUserRow>(
        "SELECT pool_id, owner FROM digipog_pool_users WHERE user_id = ? ORDER BY pool_id DESC LIMIT ? OFFSET ?",
        [userId, limit, offset]
    );

    return {
        pools,
        total: totalRow ? totalRow.count : 0,
    };
}

async function getUsersForPool(poolId: number): Promise<DigipogPoolUserRow[]> {
    return dbGetAll<DigipogPoolUserRow>("SELECT user_id, owner FROM digipog_pool_users WHERE pool_id = ?", [poolId]);
}

async function isUserInPool(userId: number, poolId: number): Promise<boolean> {
    const row = await dbGet<OneRow>("SELECT 1 FROM digipog_pool_users WHERE pool_id = ? AND user_id = ? LIMIT 1", [poolId, userId]);
    return !!row;
}

async function isUserOwner(userId: number, poolId: number): Promise<boolean> {
    const row = await dbGet<OwnerRow>("SELECT owner FROM digipog_pool_users WHERE pool_id = ? AND user_id = ? LIMIT 1", [poolId, userId]);
    return !!(row && row.owner);
}

async function isPoolOwnedByUser(poolId: number, userId: number): Promise<boolean> {
    return isUserOwner(userId, poolId);
}

function poolOwnerCheck(req: AuthenticatedRequest): Promise<boolean> {
    return isUserOwner(req.user.id, Number(req.params.id));
}

async function addUserToPool(poolId: number, userId: number, ownerFlag: number = 0): Promise<number> {
    return dbRun("INSERT OR REPLACE INTO digipog_pool_users (pool_id, user_id, owner) VALUES (?, ?, ?)", [poolId, userId, ownerFlag ? 1 : 0]);
}

async function removeUserFromPool(poolId: number, userId: number): Promise<void> {
    if (await isUserOwner(userId, poolId)) {
        const poolUsers = await getUsersForPool(poolId);
        const otherOwners = poolUsers.filter((poolUser) => poolUser.user_id !== userId && poolUser.owner);
        if (otherOwners.length === 0) {
            await dbRun("DELETE FROM digipog_pools WHERE id = ?", [poolId]);
            await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [poolId]);
            return;
        }
    }
    await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ? AND user_id = ?", [poolId, userId]);
}

async function setUserOwnerFlag(poolId: number, userId: number, ownerFlag: number): Promise<number> {
    return dbRun("UPDATE digipog_pool_users SET owner = ? WHERE pool_id = ? AND user_id = ?", [ownerFlag ? 1 : 0, poolId, userId]);
}

async function addMemberToPool({ actingUserId, poolId, userId }: AddMemberParams): Promise<OperationResult> {
    if (!Number.isInteger(poolId) || poolId <= 0) {
        return { success: false, message: "Invalid pool ID." };
    }

    if (!Number.isInteger(userId) || userId <= 0) {
        return { success: false, message: "Invalid user ID." };
    }

    const isOwner = await isUserOwner(actingUserId, poolId);
    if (!isOwner) {
        return { success: false, message: "You do not own this pool." };
    }

    const userToAdd = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
    if (!userToAdd) {
        return { success: false, message: "User not found." };
    }

    const isInPool = await isUserInPool(userId, poolId);
    if (isInPool) {
        return { success: false, message: "User is already a member of this pool." };
    }

    await addUserToPool(poolId, userId, 0);

    return { success: true, message: "User added to pool successfully." };
}

async function removeMemberFromPool({ actingUserId, poolId, userId }: RemoveMemberParams): Promise<OperationResult> {
    if (typeof poolId !== "number" || poolId <= 0) {
        return { success: false, message: "Invalid pool ID." };
    }

    if (typeof userId !== "number" || userId <= 0) {
        return { success: false, message: "Invalid user ID." };
    }

    const isOwner = await isUserOwner(actingUserId, poolId);
    if (!isOwner) {
        return { success: false, message: "You do not own this pool." };
    }

    const isInPool = await isUserInPool(userId, poolId);
    if (!isInPool) {
        return { success: false, message: "User is not a member of this pool." };
    }

    await removeUserFromPool(poolId, userId);

    return { success: true, message: "User removed from pool successfully." };
}

async function payoutPool({ actingUserId, poolId }: PayoutPoolParams): Promise<OperationResult> {
    if (typeof poolId !== "number" || poolId < 0) {
        return { success: false, message: "Invalid pool ID." };
    }

    const isOwner = await isUserOwner(actingUserId, poolId);
    if (!isOwner) {
        return { success: false, message: "You do not own this pool." };
    }

    const pool = await getPoolById(poolId);
    if (!pool) {
        return { success: false, message: "Pool not found." };
    }

    const members = await getUsersForPool(poolId);
    if (members.length === 0) {
        return { success: false, message: "Pool has no members." };
    }

    const amountPerMember = Math.floor(pool.amount / members.length);

    try {
        await dbRun("BEGIN TRANSACTION");
        for (const member of members) {
            const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [member.user_id]);
            if (!user) continue;

            await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [amountPerMember, member.user_id]);
            await dbRun("INSERT INTO transactions (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                pool.id,
                member.user_id,
                "pool",
                "user",
                amountPerMember,
                "Pool Payout",
                Date.now(),
            ]);
        }

        await dbRun("UPDATE digipog_pools SET amount = 0 WHERE id = ?", [poolId]);
        await dbRun("COMMIT");
    } catch (err: unknown) {
        await dbRun("ROLLBACK");
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        throw new AppError("An error occurred while processing the pool payout.", { event: "digipog_pool_payout_error", error: errorMessage });
    }

    return { success: true, message: "Pool payout successful." };
}

// --- Transactions ---

async function getUserTransactions(userId: number): Promise<EnrichedTransaction[]> {
    const transactions = await dbGetAll<ExtendedTransactionRow>(
        "SELECT * FROM transactions WHERE (from_id = ? AND from_type = 'user') OR (to_id = ? AND to_type = 'user') ORDER BY date DESC",
        [userId, userId]
    );
    return enrichTransactions(transactions);
}

async function getUserTransactionsPaginated(
    userId: number,
    limit: number = 25,
    offset: number = 0
): Promise<{ transactions: EnrichedTransaction[]; total: number }> {
    const whereQuery = "WHERE (from_id = ? AND from_type = 'user') OR (to_id = ? AND to_type = 'user')";
    const params: unknown[] = [userId, userId];

    const totalRow = await dbGet<CountRow>(`SELECT COUNT(*) AS count FROM transactions ${whereQuery}`, params);
    const transactions = await dbGetAll<ExtendedTransactionRow>(`SELECT * FROM transactions ${whereQuery} ORDER BY date DESC LIMIT ? OFFSET ?`, [
        ...params,
        limit,
        offset,
    ]);
    const enrichedTransactions = await enrichTransactions(transactions);

    return {
        transactions: enrichedTransactions,
        total: totalRow ? totalRow.count : 0,
    };
}

async function enrichTransactions(transactions: ExtendedTransactionRow[]): Promise<EnrichedTransaction[]> {
    if (!transactions || transactions.length === 0) {
        return [];
    }

    const userIds = new Set<number>();
    const poolIds = new Set<number>();
    const classIds = new Set<number>();

    for (const transaction of transactions) {
        if (transaction.from_id != null) {
            if (transaction.from_type === "user" || transaction.from_type === "award") {
                userIds.add(transaction.from_id);
            } else if (transaction.from_type === "pool") {
                poolIds.add(transaction.from_id);
            } else if (transaction.from_type === "class") {
                classIds.add(transaction.from_id);
            }
        }

        if (transaction.to_id != null) {
            if (transaction.to_type === "user" || transaction.to_type === "award") {
                userIds.add(transaction.to_id);
            } else if (transaction.to_type === "pool") {
                poolIds.add(transaction.to_id);
            } else if (transaction.to_type === "class") {
                classIds.add(transaction.to_id);
            }
        }
    }

    const [users, pools, classes] = await Promise.all([
        fetchUsersByIds(Array.from(userIds)),
        fetchPoolsByIds(Array.from(poolIds)),
        fetchClassesByIds(Array.from(classIds)),
    ]);

    return transactions.map((transaction) => ({
        amount: transaction.amount,
        reason: transaction.reason,
        date: transaction.date,
        from: buildTransactionParty(transaction.from_id, transaction.from_type, users, pools, classes),
        to: buildTransactionParty(transaction.to_id, transaction.to_type, users, pools, classes),
    }));
}

async function fetchUsersByIds(userIds: number[]): Promise<Map<number, EntityInfo>> {
    if (userIds.length === 0) return new Map();

    const placeholders = userIds.map(() => "?").join(",");
    const users = await dbGetAll<UserDisplayRow>(`SELECT id, displayName, email FROM users WHERE id IN (${placeholders})`, userIds);

    const userMap = new Map<number, EntityInfo>();
    for (const user of users) {
        userMap.set(user.id, {
            id: user.id,
            username: user.displayName || user.email || "Unknown User",
        });
    }
    return userMap;
}

async function fetchPoolsByIds(poolIds: number[]): Promise<Map<number, EntityInfo>> {
    if (poolIds.length === 0) return new Map();

    const placeholders = poolIds.map(() => "?").join(",");
    const pools = await dbGetAll<PoolNameRow>(`SELECT id, name FROM digipog_pools WHERE id IN (${placeholders})`, poolIds);

    const poolMap = new Map<number, EntityInfo>();
    for (const pool of pools) {
        poolMap.set(pool.id, {
            id: pool.id,
            username: pool.name || "Unknown Pool",
        });
    }
    return poolMap;
}

async function fetchClassesByIds(classIds: number[]): Promise<Map<number, EntityInfo>> {
    if (classIds.length === 0) return new Map();

    const placeholders = classIds.map(() => "?").join(",");
    const classes = await dbGetAll<ClassNameRow>(`SELECT id, name FROM classroom WHERE id IN (${placeholders})`, classIds);

    const classMap = new Map<number, EntityInfo>();
    for (const classInfo of classes) {
        classMap.set(classInfo.id, {
            id: classInfo.id,
            username: classInfo.name || "Unknown Class",
        });
    }
    return classMap;
}

function buildTransactionParty(
    id: number,
    type: string,
    users: Map<number, EntityInfo>,
    pools: Map<number, EntityInfo>,
    classes: Map<number, EntityInfo>
): TransactionParty {
    const normalizedType = type || "unknown";
    let username: string | null = null;

    if (normalizedType === "user" || normalizedType === "award") {
        username = users.get(id)?.username || "Unknown User";
    } else if (normalizedType === "pool") {
        username = pools.get(id)?.username || "Unknown Pool";
    } else if (normalizedType === "class") {
        username = classes.get(id)?.username || "Unknown Class";
    }

    return {
        id,
        type: normalizedType,
        username,
    };
}

// --- Award / Transfer ---

interface NormalizedRecipient {
    id?: number | string;
    type?: "user" | "pool" | "class";
    userId?: number | string;
    studentId?: number | string;
    code?: string;
}

async function awardDigipogs(awardData: AwardData, user: AwardUser): Promise<OperationResult> {
    try {
        const from = user?.userId ?? user?.id;
        const amount = Math.ceil(Number(awardData?.amount));
        const reason = awardData?.reason || "Awarded";

        let to: NormalizedRecipient | number | string | undefined = awardData?.to;
        let deprecatedFormatUsed = false;
        if (typeof to === "string" || typeof to === "number") {
            to = { id: to, type: "user" };
            deprecatedFormatUsed = true;
        } else if (!to && (awardData?.userId || awardData?.studentId)) {
            to = { id: (awardData.userId || awardData.studentId)!, type: "user" };
            deprecatedFormatUsed = true;
        }

        if (!to || typeof to !== "object") {
            return { success: false, message: "Missing recipient identifier." };
        }

        let normalizedTo: NormalizedRecipient = { ...to };

        if (!normalizedTo.id && (normalizedTo.userId || normalizedTo.studentId)) {
            normalizedTo.id = (normalizedTo.userId || normalizedTo.studentId)!;
            if (!normalizedTo.type) normalizedTo.type = "user";
            deprecatedFormatUsed = true;
        }
        if (!normalizedTo.type) {
            normalizedTo.type = "user";
            deprecatedFormatUsed = true;
        }

        if (!from || Number.isNaN(amount)) {
            return { success: false, message: "Missing required fields." };
        } else if (normalizedTo.type !== "user" && normalizedTo.type !== "pool" && normalizedTo.type !== "class") {
            return { success: false, message: "Invalid recipient type." };
        } else if (amount <= 0) {
            return { success: false, message: "Amount must be greater than zero." };
        } else if (normalizedTo.type !== "class" && !normalizedTo.id) {
            return { success: false, message: "Missing recipient identifier." };
        }

        const accountId = `award-${from}`;
        const fail = (message: string): OperationResult => {
            recordAttempt(accountId, false);
            return { success: false, message };
        };

        const rateLimitCheck = checkRateLimit(accountId);
        if (!rateLimitCheck.allowed) {
            return { success: false, message: rateLimitCheck.message!, rateLimited: true, waitTime: rateLimitCheck.waitTime };
        }

        const fromUser = await dbGet<UserPermRow>("SELECT email, permissions FROM users WHERE id = ?", [from]);
        if (!fromUser || !fromUser.email) {
            return fail("Sender account not found.");
        }

        if (normalizedTo.type === "class") {
            if (normalizedTo.code) {
                const classId = await getClassIDFromCode(normalizedTo.code);
                if (!classId) {
                    return fail("Invalid class code.");
                }
                normalizedTo.id = classId;
            } else if (!normalizedTo.id) {
                return fail("Missing class identifier.");
            }

            const classInfo = await dbGet<ClassOwnerRow>("SELECT c.id, c.owner FROM classroom c WHERE c.id = ?", [normalizedTo.id]);
            if (!classInfo) {
                return fail("Recipient class not found.");
            }

            let classPermissions = 0;
            if (classInfo.owner === from) {
                classPermissions = TEACHER_PERMISSIONS;
            } else {
                const permRow = await dbGet<PermRow>("SELECT permissions FROM classusers WHERE classId = ? AND studentId = ?", [
                    normalizedTo.id,
                    from,
                ]);
                classPermissions = permRow ? permRow.permissions : 0;
            }

            if (classPermissions < TEACHER_PERMISSIONS && fromUser.permissions < TEACHER_PERMISSIONS) {
                return fail("Sender does not have permission to award to this class.");
            }

            await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id IN (SELECT studentId FROM classusers WHERE classId = ?) OR id = ?", [
                amount,
                normalizedTo.id,
                classInfo.owner,
            ]);
        } else if (normalizedTo.type === "pool") {
            if (!normalizedTo.id) {
                return fail("Missing pool identifier.");
            }
            if (fromUser.permissions < TEACHER_PERMISSIONS) {
                return fail("Sender does not have permission to award to pools.");
            }
            const poolInfo = await dbGet<DigipogPoolRow>("SELECT * FROM digipog_pools WHERE id = ?", [normalizedTo.id]);
            if (!poolInfo) {
                return fail("Recipient pool not found.");
            }
            await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [amount, normalizedTo.id]);
        } else if (normalizedTo.type === "user") {
            const toUser = await dbGet<UserIdRow>("SELECT id FROM users WHERE id = ?", [normalizedTo.id]);
            if (!toUser) {
                return fail("Recipient account not found.");
            }

            if (fromUser.permissions < TEACHER_PERMISSIONS) {
                const hasPermission = await dbGet<OneRow>(
                    "SELECT 1 FROM classusers cu1 INNER JOIN classroom c ON c.id = cu1.classId WHERE cu1.studentId = ? AND (cu1.classId IN (SELECT classId FROM classusers cu2 WHERE cu2.studentId = ? AND cu2.permissions >= ?) OR c.owner = ?)",
                    [normalizedTo.id, from, TEACHER_PERMISSIONS, from]
                );
                if (!hasPermission) {
                    return fail("Sender does not have permission to award to this user.");
                }
            }

            await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [amount, normalizedTo.id]);
        }

        try {
            await dbRun("INSERT INTO transactions (from_id, to_id, from_type, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                from,
                normalizedTo.id,
                "award",
                normalizedTo.type,
                amount,
                reason,
                Date.now(),
            ]);
        } catch (_err: unknown) {
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
    } catch (_err: unknown) {
        return { success: false, message: "Database error." };
    }
}

interface NormalizedTransferParty {
    id: number | string;
    type: "user" | "pool";
}

interface FromAccountWithPin {
    digipogs?: number;
    amount?: number;
    pin: string | null;
}

async function transferDigipogs(transferData: TransferData): Promise<OperationResult> {
    try {
        const { pin, reason = "", pool } = transferData;
        let from: NormalizedTransferParty | number | string = transferData.from;
        let to: NormalizedTransferParty | number | string = transferData.to;
        const amount = Math.floor(transferData.amount);

        let deprecatedFormatUsed = false;
        if (typeof from === "string" || typeof from === "number") {
            if (typeof to !== "string" && typeof to !== "number") {
                return { success: false, message: "Missing recipient identifier." };
            }
            from = { id: from, type: "user" };
            to = { id: pool ? pool : to, type: pool ? "pool" : "user" };
            deprecatedFormatUsed = true;
        } else if (!from || !from.id) {
            return { success: false, message: "Missing sender identifier." };
        }
        if (!from.type) (from as NormalizedTransferParty).type = "user";

        if (typeof to === "string" || typeof to === "number") {
            to = { id: to, type: pool ? "pool" : "user" };
        } else if (!to || typeof to !== "object") {
            return { success: false, message: "Missing recipient identifier." };
        }
        if (!to.type) (to as NormalizedTransferParty).type = "user";

        const normalizedFrom = from as NormalizedTransferParty;
        const normalizedTo = to as NormalizedTransferParty;

        if (!normalizedFrom || !normalizedFrom.id || !normalizedTo || !normalizedTo.id || !amount || reason === undefined || !pin) {
            return { success: false, message: "Missing required fields." };
        } else if (amount <= 0) {
            return { success: false, message: "Amount must be greater than zero." };
        } else if (normalizedFrom.type === normalizedTo.type && normalizedFrom.id === normalizedTo.id) {
            return { success: false, message: "Cannot transfer to the same account." };
        } else if (
            (normalizedFrom.type !== "user" && normalizedFrom.type !== "pool") ||
            (normalizedTo.type !== "user" && normalizedTo.type !== "pool")
        ) {
            return { success: false, message: "Invalid sender or recipient type." };
        }

        const accountId = `${normalizedFrom.type}-${normalizedFrom.id}`;
        const rateLimitCheck = checkRateLimit(accountId);
        if (!rateLimitCheck.allowed) {
            return { success: false, message: rateLimitCheck.message!, rateLimited: true, waitTime: rateLimitCheck.waitTime };
        }

        let fromAccount: FromAccountWithPin;
        if (normalizedFrom.type === "user") {
            const userAccount = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [normalizedFrom.id]);
            if (!userAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Sender account not found." };
            }
            fromAccount = { digipogs: userAccount.digipogs, pin: userAccount.pin };
        } else {
            const poolAccount = await dbGet<DigipogPoolRow>("SELECT * FROM digipog_pools WHERE id = ?", [normalizedFrom.id]);
            const poolUser = await dbGet<PoolUserRow>("SELECT user_id FROM digipog_pool_users WHERE pool_id = ? AND owner = 1", [
                normalizedFrom.id,
            ]);
            if (!poolAccount) {
                recordAttempt(accountId, false);
                return { success: false, message: "Sender pool not found." };
            }
            const poolOwner = await dbGet<UserPinRow>("SELECT pin FROM users WHERE id = ?", [poolUser!.user_id]);
            fromAccount = { amount: poolAccount.amount, pin: poolOwner!.pin };
        }

        if (!fromAccount.pin) {
            recordAttempt(accountId, false);
            return { success: false, message: "Account PIN not configured." };
        }

        const isPinValid: boolean = await compare(String(pin), fromAccount.pin);
        if (!isPinValid) {
            recordAttempt(accountId, false);
            return { success: false, message: "Invalid PIN." };
        }

        const fromBalance = normalizedFrom.type === "user" ? fromAccount.digipogs! : fromAccount.amount!;
        if (fromBalance < amount) {
            recordAttempt(accountId, false);
            return { success: false, message: "Insufficient funds." };
        }

        const taxedAmount = Math.floor(amount * 0.9) > 1 ? Math.floor(amount * 0.9) : 1;
        const taxAmount = amount - taxedAmount;

        if (normalizedTo.type === "user") {
            const toUser = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [normalizedTo.id]);
            if (!toUser) {
                recordAttempt(accountId, false);
                return { success: false, message: "Recipient account not found." };
            }
        } else {
            const toPool = await dbGet<DigipogPoolRow>("SELECT * FROM digipog_pools WHERE id = ?", [normalizedTo.id]);
            if (!toPool) {
                recordAttempt(accountId, false);
                return { success: false, message: "Recipient pool not found." };
            }
        }

        try {
            await dbRun("BEGIN TRANSACTION");
            if (normalizedFrom.type === "user") {
                await dbRun("UPDATE users SET digipogs = digipogs - ? WHERE id = ?", [amount, normalizedFrom.id]);
            } else {
                await dbRun("UPDATE digipog_pools SET amount = amount - ? WHERE id = ?", [amount, normalizedFrom.id]);
            }
            if (normalizedTo.type === "user") {
                await dbRun("UPDATE users SET digipogs = digipogs + ? WHERE id = ?", [taxedAmount, normalizedTo.id]);
            } else {
                await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [taxedAmount, normalizedTo.id]);
            }
            const devPool = await dbGet<DigipogPoolRow>("SELECT * FROM digipog_pools WHERE id = ?", [0]);
            if (devPool) await dbRun("UPDATE digipog_pools SET amount = amount + ? WHERE id = ?", [taxAmount, 0]);
            await dbRun("COMMIT");
        } catch (_err: unknown) {
            try {
                await dbRun("ROLLBACK");
            } catch (_rollbackErr: unknown) {
                /* rollback best-effort */
            }
            recordAttempt(accountId, false);
            return { success: false, message: "Transfer failed due to database error." };
        }

        try {
            await dbRun("INSERT INTO transactions (from_id, from_type, to_id, to_type, amount, reason, date) VALUES (?, ?, ?, ?, ?, ?, ?)", [
                normalizedFrom.id,
                normalizedFrom.type,
                normalizedTo.id,
                normalizedTo.type,
                amount,
                reason,
                Date.now(),
            ]);
        } catch (_err: unknown) {
            /* transaction logging best-effort */
        }

        recordAttempt(accountId, true);
        return {
            success: true,
            message: `Transfer successful. ${deprecatedFormatUsed ? "Warning: Deprecated transfer format used. See documentation for updated usage." : ""}`,
        };
    } catch (_err: unknown) {
        return { success: false, message: "Database error." };
    }
}

module.exports = {
    // Transactions
    getUserTransactions,
    getUserTransactionsPaginated,
    awardDigipogs,
    transferDigipogs,

    // Pool helpers
    createPool,
    deletePool,
    getPoolsForUser,
    getPoolsForUserPaginated,
    getUsersForPool,
    getPoolById,
    isUserInPool,
    isUserOwner,
    isPoolOwnedByUser,
    poolOwnerCheck,
    addUserToPool,
    removeUserFromPool,
    setUserOwnerFlag,
    addMemberToPool,
    removeMemberFromPool,
    payoutPool,
};
