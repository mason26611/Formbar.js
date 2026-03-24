const { dbGetAll, dbGet } = require("@modules/database");
const jwt = require("jsonwebtoken");

const MANAGER_SORTS = {
    name: "LOWER(COALESCE(displayName, email)) ASC, id ASC",
    permission: "permissions DESC, LOWER(COALESCE(displayName, email)) ASC, id ASC",
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
        clause: "WHERE INSTR(LOWER(COALESCE(displayName, email)), ?) > 0 OR INSTR(LOWER(email), ?) > 0",
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
        permissions: decodedData.permissions,
        displayName: decodedData.displayName,
        verified: 0,
    };
}

async function getPendingUsers(search = "", sortBy = "name") {
    const unverifiedUsers = await dbGetAll("SELECT id, email, permissions, displayName, verified FROM users WHERE verified = 0");
    const tempUsers = await dbGetAll("SELECT token FROM temp_user_creation_data");
    const normalizedSearch = String(search || "")
        .trim()
        .toLowerCase();

    // First, decode all tokens and build candidate pending users.
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

    // Batch query to find emails that already exist in users so we don't show
    // duplicate legacy pending records alongside real user rows.
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
    const totalRow = await dbGet(`SELECT COUNT(*) AS count FROM users ${clause}`, params);
    const users = await dbGetAll(
        `SELECT id, email, permissions, displayName, verified FROM users ${clause} ORDER BY ${MANAGER_SORTS[normalizedSort]} LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    return {
        users,
        total: totalRow ? totalRow.count : 0,
    };
}

async function getManagerData() {
    //TODO DO NOT PUT ALL USERS IN MEMORY, THIS IS BAD, NEED TO PAGINATE OR SOMETHING
    const users = await dbGetAll("SELECT id, email, permissions, displayName, verified FROM users");
    const classrooms = await dbGetAll("SELECT * FROM classroom");
    const pendingUserIds = new Set();
    const existingEmails = new Set(users.map((user) => user.email));

    for (const user of users) {
        if (!user.verified) {
            pendingUserIds.add(String(user.id));
        }
    }

    // Grab the unverified users from the database and insert them into the user data
    const tempUsers = await dbGetAll("SELECT * FROM temp_user_creation_data");
    for (const tempUser of tempUsers) {
        // Grab the token, decode it, and check if they're already accounted for in the users table
        const token = tempUser.token;
        const decodedData = jwt.decode(token);
        if (!decodedData || pendingUserIds.has(String(decodedData.newSecret)) || existingEmails.has(decodedData.email)) {
            continue;
        }

        users[decodedData.newSecret] = {
            id: decodedData.newSecret,
            email: decodedData.email,
            permissions: decodedData.permissions,
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
