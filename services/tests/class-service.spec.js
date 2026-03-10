/**
 * Unit tests for services/class-service.js
 *
 * Focuses on:
 *  - Pure helper functions (validateClassroomName, normalizeClassroomData)
 *  - Database-only read functions (getClassCode, getClassIdByCode,
 *    getUserJoinedClasses, getClassLinks)
 *  - createClass (DB + in-memory state; no socket emissions at creation time)
 *
 * Functions that emit socket events (startClass, endClass, joinClass, etc.) are
 * *not* exercised here as they require a live socket server.
 *
 * Uses an in-memory SQLite database so no real DB file is touched.
 */
const { createTestDb } = require("@test-helpers/db");

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

// manager-service is mocked globally by jest.setup.js; that is fine here since
// class-service delegates to it only via socket-updates-service which we don't
// exercise in these tests.

const {
    validateClassroomName,
    createClass,
    getClassCode,
    getClassIdByCode,
    getUserJoinedClasses,
    getClassLinks,
} = require("@services/class-service");

const { classStateStore } = require("@services/classroom-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    // Wipe in-memory class state so tests don't bleed into each other
    classStateStore._state = { users: {}, classrooms: {} };
    // Clear code → id cache
    const { classCodeCacheStore } = require("@stores/class-code-cache-store");
    classCodeCacheStore.clear();
});

afterAll(async () => {
    await mockDatabase.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const crypto = require("crypto");

async function seedUser(email = "owner@example.com", displayName = "Owner") {
    const id = await mockDatabase.dbRun(
        "INSERT INTO users (email, password, permissions, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [email, "hashed", 4, crypto.randomBytes(8).toString("hex"), crypto.randomBytes(8).toString("hex"), displayName, 1]
    );
    return { id, email, displayName };
}

async function seedClassroom({ name = "Test Class", ownerId = 1, key = 1234 } = {}) {
    const id = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", [name, ownerId, key]);
    await mockDatabase.dbRun("INSERT OR IGNORE INTO class_permissions (classId) VALUES (?)", [id]);
    return { id, name, ownerId, key };
}

// validateClassroomName()
describe("validateClassroomName()", () => {
    it("returns { valid: true } for a normal classroom name", () => {
        expect(validateClassroomName("Intro to CS")).toEqual({ valid: true });
    });

    it("accepts names with allowed special characters (- _ . ' ( ) & ,)", () => {
        expect(validateClassroomName("Mrs. Smith's Class")).toEqual({ valid: true });
        expect(validateClassroomName("Period 1 - Math")).toEqual({ valid: true });
        expect(validateClassroomName("Science & Tech")).toEqual({ valid: true });
    });

    it("rejects a name shorter than 3 characters", () => {
        const result = validateClassroomName("AB");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/3 characters/i);
    });

    it("rejects a name longer than 30 characters", () => {
        const result = validateClassroomName("A".repeat(31));
        expect(result.valid).toBe(false);
    });

    it("rejects an empty string", () => {
        const result = validateClassroomName("");
        expect(result.valid).toBe(false);
    });

    it("rejects null", () => {
        const result = validateClassroomName(null);
        expect(result.valid).toBe(false);
    });

    it("rejects undefined", () => {
        const result = validateClassroomName(undefined);
        expect(result.valid).toBe(false);
    });

    it("rejects names with consecutive spaces", () => {
        const result = validateClassroomName("Class  Name");
        expect(result.valid).toBe(false);
    });

    it("rejects names with disallowed characters (e.g. @)", () => {
        const result = validateClassroomName("Bad@Name");
        expect(result.valid).toBe(false);
    });
});

// getClassCode()
describe("getClassCode()", () => {
    it("returns the class code for a valid class id", async () => {
        const { id, key } = await seedClassroom({ key: 5678 });
        const result = await getClassCode(id);
        expect(result).toBe(5678);
    });

    it("returns null for a non-existent class id", async () => {
        const result = await getClassCode(99999);
        expect(result).toBeNull();
    });
});

// getClassIdByCode()
describe("getClassIdByCode()", () => {
    it("returns the class id for a valid code", async () => {
        const { id } = await seedClassroom({ key: 4321 });
        const result = await getClassIdByCode(4321);
        expect(result).toBe(id);
    });

    it("returns null for a code that does not exist", async () => {
        const result = await getClassIdByCode(9999);
        expect(result).toBeNull();
    });
});

// getUserJoinedClasses()
describe("getUserJoinedClasses()", () => {
    it("returns an empty array when the user has not joined any classes", async () => {
        const result = await getUserJoinedClasses(999);
        expect(result).toEqual([]);
    });

    it("returns joined classes with name, id, and permissions", async () => {
        const owner = await seedUser();
        const { id: classId } = await seedClassroom({ ownerId: owner.id, name: "Biology" });
        await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId, permissions) VALUES (?, ?, ?)", [classId, owner.id, 4]);

        const result = await getUserJoinedClasses(owner.id);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Biology");
        expect(result[0].id).toBe(classId);
        expect(result[0]).toHaveProperty("permissions");
    });

    it("does not return classes the user has not joined", async () => {
        const owner = await seedUser("owner2@example.com", "Owner2");
        await seedClassroom({ ownerId: owner.id, name: "Physics" }); // no classusers entry
        const result = await getUserJoinedClasses(owner.id);
        expect(result).toHaveLength(0);
    });
});

// getClassLinks()
describe("getClassLinks()", () => {
    it("returns an empty array when the class has no links", async () => {
        const { id } = await seedClassroom();
        const result = await getClassLinks(id);
        expect(result).toEqual([]);
    });

    it("returns links for the given class", async () => {
        const { id } = await seedClassroom();
        await mockDatabase.dbRun("INSERT INTO links (name, url, classId) VALUES (?, ?, ?)", ["Google", "https://google.com", id]);
        await mockDatabase.dbRun("INSERT INTO links (name, url, classId) VALUES (?, ?, ?)", ["Docs", "https://docs.google.com", id]);

        const result = await getClassLinks(id);
        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty("name");
        expect(result[0]).toHaveProperty("url");
    });

    it("does not return links belonging to other classes", async () => {
        const { id: id1 } = await seedClassroom({ name: "Class A", key: 1111 });
        const { id: id2 } = await seedClassroom({ name: "Class B", key: 2222 });
        await mockDatabase.dbRun("INSERT INTO links (name, url, classId) VALUES (?, ?, ?)", ["Link", "https://example.com", id2]);

        const result = await getClassLinks(id1);
        expect(result).toHaveLength(0);
    });
});

// createClass()
describe("createClass()", () => {
    it("creates a classroom row in the database", async () => {
        const owner = await seedUser();
        await createClass("New Class", owner.id, owner.email);

        const rows = await mockDatabase.dbGetAll("SELECT * FROM classroom");
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe("New Class");
        expect(rows[0].owner).toBe(owner.id);
    });

    it("creates a class_permissions row for the new class", async () => {
        const owner = await seedUser();
        const result = await createClass("Permissions Class", owner.id, owner.email);

        const permissions = await mockDatabase.dbGet("SELECT * FROM class_permissions WHERE classId = ?", [result.classId]);
        expect(permissions).toBeDefined();
    });

    it("returns classId, key, and className", async () => {
        const owner = await seedUser();
        const result = await createClass("My Class", owner.id, owner.email);

        expect(result).toHaveProperty("classId");
        expect(result).toHaveProperty("key");
        expect(result).toHaveProperty("className", "My Class");
    });

    it("initialises the class in the in-memory classStateStore", async () => {
        const owner = await seedUser();
        const result = await createClass("State Class", owner.id, owner.email);

        const classroom = classStateStore.getClassroom(result.classId);
        expect(classroom).toBeDefined();
        expect(classroom.className).toBe("State Class");
    });

    it("throws ValidationError for an invalid classroom name", async () => {
        const owner = await seedUser();
        await expect(createClass("AB", owner.id, owner.email)).rejects.toThrow(/classroom name/i);
    });

    it("throws ValidationError for an empty classroom name", async () => {
        const owner = await seedUser();
        await expect(createClass("", owner.id, owner.email)).rejects.toThrow();
    });
});
