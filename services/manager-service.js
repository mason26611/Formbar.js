const { dbGetAll, dbGet } = require("@modules/database");
const { computePermissionLevel } = require("@modules/permissions");
const { getUserRoleName } = require("@modules/scope-resolver");
const jwt = require("jsonwebtoken");

const MANAGER_SORTS = {
    name: "LOWER(COALESCE(u.displayName, u.email)) ASC, u.id ASC",
    permission: "perm_level DESC, LOWER(COALESCE(u.displayName, u.email)) ASC, u.id ASC",
};

function normalizeManagerSort(sortBy) {
    if (!sortBy) return "name";

    const normalized = String(sortBy).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(MANAGER_SORTS, normalized) ? normalized : "name";
}

function buildManagerUserSearch(search) {
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
        clause: "WHERE INSTR(LOWER(COALESCE(u.displayName, u.email)), ?) > 0 OR INSTR(LOWER(u.email), ?) > 0",
        params: [searchTerm, searchTerm],
    };
}

function buildPendingUser(decodedData) {
    if (!decodedData || !decodedData.newSecret || !decodedData.email) {
        return null;
    }

    return {
        id: decodedData.newSecret,
        email: decodedData.email,
        permissions: decodedData.permissions || 0,
        displayName: decodedData.displayName,
        verified: 0,
    };
}

async function getPendingUsers(search = "", sortBy = "name") {
    // Get unverified users and compute their permission levels from roles
    const unverifiedUsers = await dbGetAll(
        `SELECT u.id, u.email, u.displayName, u.verified,
                COALESCE(MAX(
                    CASE r.name
                        WHEN 'Manager' THEN 5
                        WHEN 'Teacher' THEN 4
                        WHEN 'Mod' THEN 3
                        WHEN 'Student' THEN 2
                        WHEN 'Guest' THEN 1
                        WHEN 'Banned' THEN 0
                        ELSE 1
                    END
                ), 1) AS permissions
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.userId AND ur.classId IS NULL
         LEFT JOIN roles r ON ur.roleId = r.id
         WHERE u.verified = 0
         GROUP BY u.id`
    );
    const tempUsers = await dbGetAll("SELECT token FROM temp_user_creation_data");
    const normalizedSearch = String(search || "")
        .trim()
        .toLowerCase();

    const candidates = [];
    for (const tempUser of tempUsers) {
        const decodedData = jwt.decode(tempUser.token);
        const pendingUser = buildPendingUser(decodedData);
        if (!pendingUser) {
            continue;
        }
        candidates.push(pendingUser);
    }

    const pendingUsers = normalizedSearch
        ? unverifiedUsers.filter((user) => `${user.displayName || ""} ${user.email}`.toLowerCase().includes(normalizedSearch))
        : [...unverifiedUsers];
    const existingIdSet = new Set(pendingUsers.map((user) => String(user.id)));
    const existingPendingEmailSet = new Set(pendingUsers.map((user) => user.email));

    const emails = candidates.map((u) => u.email);
    const existingUserEmailSet =
        emails.length > 0
            ? new Set(
                  (await dbGetAll(`SELECT email FROM users WHERE email IN (${emails.map(() => "?").join(", ")})`, emails)).map((row) => row.email)
              )
            : new Set();

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

async function getPaginatedManagerUsers(limit = 24, offset = 0, search = "", sortBy = "name") {
    const normalizedSort = normalizeManagerSort(sortBy);
    const { clause, params } = buildManagerUserSearch(search);
    const totalRow = await dbGet(`SELECT COUNT(*) AS count FROM users u ${clause}`, params);
    const users = await dbGetAll(
        `SELECT u.id, u.email, u.displayName, u.verified,
                COALESCE(MAX(
                    CASE r.name
                        WHEN 'Manager' THEN 5
                        WHEN 'Teacher' THEN 4
                        WHEN 'Mod' THEN 3
                        WHEN 'Student' THEN 2
                        WHEN 'Guest' THEN 1
                        WHEN 'Banned' THEN 0
                        ELSE 1
                    END
                ), 1) AS perm_level
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.userId AND ur.classId IS NULL
         LEFT JOIN roles r ON ur.roleId = r.id
         ${clause}
         GROUP BY u.id
         ORDER BY ${MANAGER_SORTS[normalizedSort]} LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    // Map perm_level to permissions for API compat
    for (const user of users) {
        user.permissions = user.perm_level;
        delete user.perm_level;
    }

    return {
        users,
        total: totalRow ? totalRow.count : 0,
    };
}

async function getManagerData() {
    const users = await dbGetAll(
        `SELECT u.id, u.email, u.displayName, u.verified,
                COALESCE(MAX(
                    CASE r.name
                        WHEN 'Manager' THEN 5
                        WHEN 'Teacher' THEN 4
                        WHEN 'Mod' THEN 3
                        WHEN 'Student' THEN 2
                        WHEN 'Guest' THEN 1
                        WHEN 'Banned' THEN 0
                        ELSE 1
                    END
                ), 1) AS permissions
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.userId AND ur.classId IS NULL
         LEFT JOIN roles r ON ur.roleId = r.id
         GROUP BY u.id`
    );
    const classrooms = await dbGetAll("SELECT * FROM classroom");
    const pendingUserIds = new Set();
    const existingEmails = new Set(users.map((user) => user.email));

    for (const user of users) {
        if (!user.verified) {
            pendingUserIds.add(String(user.id));
        }
    }

    const tempUsers = await dbGetAll("SELECT * FROM temp_user_creation_data");
    for (const tempUser of tempUsers) {
        const token = tempUser.token;
        const decodedData = jwt.decode(token);
        if (!decodedData || pendingUserIds.has(String(decodedData.newSecret)) || existingEmails.has(decodedData.email)) {
            continue;
        }

        users[decodedData.newSecret] = {
            id: decodedData.newSecret,
            email: decodedData.email,
            permissions: decodedData.permissions || 0,
            displayName: decodedData.displayName,
            verified: false,
        };
    }

    return { users, classrooms };
}

async function getManagerDataPaginated({ limit = 24, offset = 0, search = "", sortBy = "name" } = {}) {
    const [classrooms, paginatedUsers, pendingUsers] = await Promise.all([
        dbGetAll("SELECT * FROM classroom"),
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
