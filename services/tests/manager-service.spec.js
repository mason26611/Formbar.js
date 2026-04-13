/**
 * Unit tests for services/manager-service.js
 *
 * Uses an in-memory SQLite database so no real DB file is touched.
 *
 * manager-service is globally mocked in jest.setup.js for OTHER tests; here we
 * unmock it so we can exercise the real implementation.
 */
const { createTestDb } = require("@test-helpers/db");
const { setGlobalPermissionLevel } = require("@test-helpers/role-seeding");
const jwt = require("jsonwebtoken");

// Restore the real manager-service (overrides the jest.setup.js mock)
jest.unmock("@services/manager-service");

let mockDatabase;

jest.mock("@modules/database", () => {
    const dbProxy = new Proxy(
        {},
        {
            get(_, method) {
                return (...args) => mockDatabase.db[method](...args);
            },
        }
    );
    return {
        get database() {
            return dbProxy;
        },
        dbGet: (...args) => mockDatabase.dbGet(...args),
        dbRun: (...args) => mockDatabase.dbRun(...args),
        dbGetAll: (...args) => mockDatabase.dbGetAll(...args),
    };
});

const { getManagerData, getManagerDataPaginated } = require("@services/manager-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
});

afterAll(async () => {
    await mockDatabase.close();
});

let userCounter = 0;
async function seedUser(overrides = {}) {
    userCounter++;
    const crypto = require("crypto");
    const email = overrides.email ?? `user${userCounter}@example.com`;
    const displayName = overrides.displayName ?? `User${userCounter}`;
    const permissions = overrides.permissions ?? 2;
    const id = await mockDatabase.dbRun("INSERT INTO users (email, password, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?)", [
        email,
        "hashed",
        crypto.randomBytes(8).toString("hex"),
        crypto.randomBytes(8).toString("hex"),
        displayName,
        1,
    ]);
    await setGlobalPermissionLevel(mockDatabase, id, permissions);
    return { id, email, displayName, permissions };
}

async function seedClassroom(name = "Test Class", ownerId = 1) {
    const key = Math.floor(Math.random() * 9000 + 1000);
    const id = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", [name, ownerId, key]);
    return { id, name, ownerId, key };
}

async function addGlobalRole(userId, roleName) {
    const role = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = ? AND isDefault = 1", [roleName]);
    await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [userId, role.id]);
}

describe("getManagerData()", () => {
    it("returns empty users and classrooms arrays when DB is empty", async () => {
        const result = await getManagerData();
        expect(Array.isArray(result.users)).toBe(true);
        expect(Array.isArray(result.classrooms)).toBe(true);
        expect(result.users).toHaveLength(0);
        expect(result.classrooms).toHaveLength(0);
    });

    it("returns all users with id, email, permissions, displayName, verified", async () => {
        await seedUser({ email: "a@test.com", displayName: "Alpha", permissions: 5 });
        await seedUser({ email: "b@test.com", displayName: "Beta", permissions: 2 });

        const result = await getManagerData();
        expect(result.users).toHaveLength(2);

        const alpha = result.users.find((u) => u.email === "a@test.com");
        expect(alpha).toBeDefined();
        expect(alpha.permissions).toBe(5);
        expect(alpha.classPermissions).toBeNull();
    });

    it("returns all classrooms", async () => {
        const { id: ownerId } = await seedUser();
        await seedClassroom("Class A", ownerId);
        await seedClassroom("Class B", ownerId);

        const result = await getManagerData();
        expect(result.classrooms).toHaveLength(2);
    });

    it("merges pending (temp) users into the users list", async () => {
        // Create a fake JWT that looks like a pending user token
        const pendingEmail = "pending@example.com";
        const fakeToken = jwt.sign({ email: pendingEmail, displayName: "PendingUser", permissions: 2, newSecret: "secret123" }, "test-secret");
        await mockDatabase.dbRun("INSERT INTO temp_user_creation_data (token) VALUES (?)", [fakeToken]);

        const result = await getManagerData();
        const pendingUser = result.users["secret123"];
        expect(pendingUser).toBeDefined();
        expect(pendingUser.email).toBe(pendingEmail);
        expect(pendingUser.classPermissions).toBeNull();
    });

    it("treats banned as overriding other global roles", async () => {
        const user = await seedUser({ email: "mixed@test.com", displayName: "MixedUser", permissions: 4 });
        await addGlobalRole(user.id, "Banned");

        const result = await getManagerData();
        const mixedUser = result.users.find((candidate) => candidate.email === "mixed@test.com");

        expect(mixedUser.permissions).toBe(0);
    });
});

describe("getManagerDataPaginated()", () => {
    beforeEach(async () => {
        // Seed 5 users for pagination tests
        for (let i = 1; i <= 5; i++) {
            await seedUser({ email: `user${i}@test.com`, displayName: `User${String(i).padStart(2, "0")}` });
        }
    });

    it("returns users array, totalUsers count, classrooms array, and pendingUsers array", async () => {
        const result = await getManagerDataPaginated();
        expect(result).toHaveProperty("users");
        expect(result).toHaveProperty("totalUsers");
        expect(result).toHaveProperty("classrooms");
        expect(result).toHaveProperty("pendingUsers");
        expect(result.users[0].classPermissions).toBeNull();
    });

    it("returns the correct total count", async () => {
        const result = await getManagerDataPaginated();
        expect(result.totalUsers).toBe(5);
    });

    it("respects the limit parameter", async () => {
        const result = await getManagerDataPaginated({ limit: 2 });
        expect(result.users).toHaveLength(2);
    });

    it("respects the offset parameter", async () => {
        const all = await getManagerDataPaginated({ limit: 5 });
        const paged = await getManagerDataPaginated({ limit: 5, offset: 2 });
        expect(paged.users).toHaveLength(3);
        // The paged results should not include the first 2 users
        expect(paged.users[0].email).not.toBe(all.users[0].email);
    });

    it("filters users by search term (case-insensitive, display name)", async () => {
        const result = await getManagerDataPaginated({ search: "user03" });
        expect(result.users).toHaveLength(1);
        expect(result.users[0].displayName).toBe("User03");
    });

    it("filters users by search term (email)", async () => {
        const result = await getManagerDataPaginated({ search: "user2@test" });
        expect(result.users).toHaveLength(1);
        expect(result.users[0].email).toBe("user2@test.com");
    });

    it("returns empty users when search has no matches", async () => {
        const result = await getManagerDataPaginated({ search: "zzz-no-match" });
        expect(result.users).toHaveLength(0);
        expect(result.totalUsers).toBe(0);
    });

    it("sorts by name (default)", async () => {
        const result = await getManagerDataPaginated({ sortBy: "name" });
        const names = result.users.map((u) => u.displayName);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it("sorts by permission level (descending)", async () => {
        // Give one user elevated permissions
        const row = await mockDatabase.dbGet("SELECT id FROM users WHERE email = 'user1@test.com'");
        await setGlobalPermissionLevel(mockDatabase, row.id, 5);
        const result = await getManagerDataPaginated({ sortBy: "permission" });
        expect(result.users[0].permissions).toBe(5);
    });

    it("keeps banned users at permission 0 even if they also have teacher", async () => {
        const row = await mockDatabase.dbGet("SELECT id FROM users WHERE email = 'user1@test.com'");
        await setGlobalPermissionLevel(mockDatabase, row.id, 4);
        await addGlobalRole(row.id, "Banned");

        const result = await getManagerDataPaginated({ sortBy: "permission" });
        const mixedUser = result.users.find((user) => user.email === "user1@test.com");

        expect(mixedUser.permissions).toBe(0);
    });

    it("falls back to name sort for an unknown sortBy value", async () => {
        const result = await getManagerDataPaginated({ sortBy: "unknown_sort" });
        expect(result.users).toHaveLength(5);
    });
});
