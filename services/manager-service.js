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

    if (candidates.length === 0) {
        return [];
    }

    // Batch query to find emails that already exist in users.
    const emails = candidates.map((u) => u.email);
    const placeholders = emails.map(() => "?").join(", ");
    const existingRows = await dbGetAll(`SELECT email FROM users WHERE email IN (${placeholders})`, emails);
    const existingEmailSet = new Set(existingRows.map((row) => row.email));

    const pendingUsers = [];
    for (const pendingUser of candidates) {
        if (existingEmailSet.has(pendingUser.email)) {
            continue;
        }

        if (normalizedSearch) {
            const searchTarget = `${pendingUser.displayName || ""} ${pendingUser.email}`.toLowerCase();
            if (!searchTarget.includes(normalizedSearch)) {
                continue;
            }
        }

        pendingUsers.push(pendingUser);
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

    // Grab the unverified users from the database and insert them into the user data
    const tempUsers = await dbGetAll("SELECT * FROM temp_user_creation_data");
    for (const tempUser of tempUsers) {
        // Grab the token, decode it, and check if they're already accounted for in the users table
        const token = tempUser.token;
        const decodedData = jwt.decode(token);
        if (users[decodedData.email]) {
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
