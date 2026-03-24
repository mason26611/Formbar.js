import jwt = require("jsonwebtoken");
import type { TempUserCreationDataRow } from "../types/database";

const { dbGetAll, dbGet } = require("@modules/database") as {
    dbGet: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    dbGetAll: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
};

interface ManagerUser {
    id: number | string;
    email: string;
    permissions: number;
    displayName: string | null;
    verified: number | boolean;
}

interface DecodedTempUserData {
    newSecret: string;
    email: string;
    permissions: number;
    displayName: string | null;
}

interface CountRow {
    count: number;
}

interface EmailRow {
    email: string;
}

interface SearchClause {
    clause: string;
    params: string[];
}

interface PaginatedManagerResult {
    users: ManagerUser[];
    total: number;
}

interface ManagerDataResult {
    users: ManagerUser[];
    classrooms: Record<string, unknown>[];
}

interface ManagerDataPaginatedResult {
    users: ManagerUser[];
    totalUsers: number;
    classrooms: Record<string, unknown>[];
    pendingUsers: ManagerUser[];
}

const MANAGER_SORTS: Record<string, string> = {
    name: "LOWER(COALESCE(displayName, email)) ASC, id ASC",
    permission: "permissions DESC, LOWER(COALESCE(displayName, email)) ASC, id ASC",
};

function normalizeManagerSort(sortBy: string | undefined): string {
    if (!sortBy) return "name";

    const normalized = String(sortBy).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(MANAGER_SORTS, normalized) ? normalized : "name";
}

function buildManagerUserSearch(search: string | undefined): SearchClause {
    const normalized = String(search || "")
        .trim()
        .toLowerCase();
    if (!normalized) {
        return {
            clause: "",
            params: [],
        };
    }

    const searchTerm = normalized;
    return {
        clause: "WHERE INSTR(LOWER(COALESCE(displayName, email)), ?) > 0 OR INSTR(LOWER(email), ?) > 0",
        params: [searchTerm, searchTerm],
    };
}

function buildPendingUser(decodedData: DecodedTempUserData | null): ManagerUser | null {
    if (!decodedData || !decodedData.newSecret || !decodedData.email) {
        return null;
    }

    return {
        id: decodedData.newSecret,
        email: decodedData.email,
        permissions: decodedData.permissions,
        displayName: decodedData.displayName,
        verified: 0,
    };
}

async function getPendingUsers(search = "", sortBy = "name"): Promise<ManagerUser[]> {
    const unverifiedUsers = await dbGetAll<ManagerUser>("SELECT id, email, permissions, displayName, verified FROM users WHERE verified = 0");
    const tempUsers = await dbGetAll<TempUserCreationDataRow>("SELECT token FROM temp_user_creation_data");
    const normalizedSearch = String(search || "")
        .trim()
        .toLowerCase();

    const candidates: ManagerUser[] = [];
    for (const tempUser of tempUsers) {
        const decodedData = jwt.decode(tempUser.token) as DecodedTempUserData | null;
        const pendingUser = buildPendingUser(decodedData);
        if (!pendingUser) {
            continue;
        }
        candidates.push(pendingUser);
    }

    const pendingUsers: ManagerUser[] = normalizedSearch
        ? unverifiedUsers.filter((user) => `${user.displayName || ""} ${user.email}`.toLowerCase().includes(normalizedSearch))
        : [...unverifiedUsers];
    const existingIdSet = new Set(pendingUsers.map((user) => String(user.id)));
    const existingPendingEmailSet = new Set(pendingUsers.map((user) => user.email));

    const emails = candidates.map((u) => u.email);
    const existingUserEmailSet: Set<string> =
        emails.length > 0
            ? new Set(
                  (await dbGetAll<EmailRow>(`SELECT email FROM users WHERE email IN (${emails.map(() => "?").join(", ")})`, emails)).map(
                      (row: EmailRow) => row.email
                  )
              )
            : new Set<string>();

    for (const pendingUser of candidates) {
        if (
            existingUserEmailSet.has(pendingUser.email) ||
            existingPendingEmailSet.has(pendingUser.email) ||
            existingIdSet.has(String(pendingUser.id))
        ) {
            continue;
        }

        if (normalizedSearch) {
            const searchTarget = `${pendingUser.displayName || ""} ${pendingUser.email}`.toLowerCase();
            if (!searchTarget.includes(normalizedSearch)) {
                continue;
            }
        }

        pendingUsers.push(pendingUser);
        existingIdSet.add(String(pendingUser.id));
        existingPendingEmailSet.add(pendingUser.email);
    }

    pendingUsers.sort((a, b) => {
        if (sortBy === "permission") {
            if (b.permissions !== a.permissions) {
                return b.permissions - a.permissions;
            }
        }
        return String(a.displayName || a.email).localeCompare(String(b.displayName || b.email));
    });

    return pendingUsers;
}

async function getPaginatedManagerUsers(
    limit = 24,
    offset = 0,
    search = "",
    sortBy = "name"
): Promise<PaginatedManagerResult> {
    const normalizedSort = normalizeManagerSort(sortBy);
    const { clause, params } = buildManagerUserSearch(search);
    const totalRow = await dbGet<CountRow>(`SELECT COUNT(*) AS count FROM users ${clause}`, params);
    const users = await dbGetAll<ManagerUser>(
        `SELECT id, email, permissions, displayName, verified FROM users ${clause} ORDER BY ${MANAGER_SORTS[normalizedSort]} LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    return {
        users,
        total: totalRow ? totalRow.count : 0,
    };
}

async function getManagerData(): Promise<ManagerDataResult> {
    const users = await dbGetAll<ManagerUser>("SELECT id, email, permissions, displayName, verified FROM users");
    const classrooms = await dbGetAll<Record<string, unknown>>("SELECT * FROM classroom");
    const pendingUserIds = new Set<string>();
    const existingEmails = new Set(users.map((user: ManagerUser) => user.email));

    for (const user of users) {
        if (!user.verified) {
            pendingUserIds.add(String(user.id));
        }
    }

    const tempUsers = await dbGetAll<TempUserCreationDataRow>("SELECT * FROM temp_user_creation_data");
    const usersRecord = users as unknown as Record<string | number, ManagerUser>;
    for (const tempUser of tempUsers) {
        const token = tempUser.token;
        const decodedData = jwt.decode(token) as DecodedTempUserData | null;
        if (!decodedData || pendingUserIds.has(String(decodedData.newSecret)) || existingEmails.has(decodedData.email)) {
            continue;
        }

        usersRecord[decodedData.newSecret] = {
            id: decodedData.newSecret,
            email: decodedData.email,
            permissions: decodedData.permissions,
            displayName: decodedData.displayName,
            verified: false,
        };
    }

    return { users, classrooms };
}

interface GetManagerDataPaginatedParams {
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: string;
}

async function getManagerDataPaginated({
    limit = 24,
    offset = 0,
    search = "",
    sortBy = "name",
}: GetManagerDataPaginatedParams = {}): Promise<ManagerDataPaginatedResult> {
    const [classrooms, paginatedUsers, pendingUsers] = await Promise.all([
        dbGetAll<Record<string, unknown>>("SELECT * FROM classroom"),
        getPaginatedManagerUsers(limit, offset, search, sortBy),
        getPendingUsers(search, sortBy),
    ]);

    return {
        users: paginatedUsers.users,
        totalUsers: paginatedUsers.total,
        classrooms,
        pendingUsers,
    };
}

module.exports = {
    getManagerData,
    getManagerDataPaginated,
};
