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

jest.mock("@modules/config", () => ({
    settings: { emailEnabled: false },
    frontendUrl: "http://localhost:3000",
    rateLimit: {
        maxAttempts: 5,
        lockoutDuration: 900000,
        minDelayBetweenAttempts: 1000,
        attemptWindow: 300000,
    },
}));

const mockUsers = {};
jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getUser: jest.fn((email) => mockUsers[email] || null),
        getAllUsers: jest.fn(() => mockUsers),
        setUser: jest.fn((email, u) => {
            mockUsers[email] = u;
        }),
    },
    Classroom: jest.fn(),
}));

const {
    Student,
    createStudentFromUserData,
    getStudentsInClass,
    getIdFromEmail,
    getEmailFromId,
} = require("@services/student-service");
const { classStateStore } = require("@services/classroom-service");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    jest.clearAllMocks();
    for (const k of Object.keys(mockUsers)) delete mockUsers[k];
});

afterAll(async () => {
    await mockDatabase.close();
});

let seedCounter = 0;
async function seedUser(overrides = {}) {
    seedCounter += 1;
    const defaults = {
        email: "student@test.com",
        password: "hashed",
        permissions: 2,
        API: `api-${Date.now()}-${seedCounter}-${Math.random()}`,
        secret: `sec-${Date.now()}-${seedCounter}-${Math.random()}`,
        displayName: `Student_${Date.now()}_${seedCounter}`,
        digipogs: 0,
        pin: null,
        verified: 0,
    };
    const u = { ...defaults, ...overrides };
    const id = await mockDatabase.dbRun(
        "INSERT INTO users (email, password, permissions, API, secret, displayName, digipogs, pin, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [u.email, u.password, u.permissions, u.API, u.secret, u.displayName, u.digipogs, u.pin, u.verified]
    );
    return { id, ...u };
}

async function seedClassUser(classId, studentId, overrides = {}) {
    const defaults = { permissions: 2, digiPogs: 0, role: null };
    const cu = { ...defaults, ...overrides };
    await mockDatabase.dbRun(
        "INSERT INTO classusers (classId, studentId, permissions, digiPogs, role) VALUES (?, ?, ?, ?, ?)",
        [classId, studentId, cu.permissions, cu.digiPogs, cu.role]
    );
}

describe("Student class", () => {
    it("sets all properties with defaults", () => {
        const s = new Student("a@b.com", 1, undefined, "key123");
        expect(s.email).toBe("a@b.com");
        expect(s.id).toBe(1);
        expect(s.permissions).toBe(2);
        expect(s.API).toBe("key123");
        expect(s.ownedPolls).toEqual([]);
        expect(s.sharedPolls).toEqual([]);
        expect(s.tags).toEqual([]);
        expect(s.displayName).toBeUndefined();
        expect(s.isGuest).toBe(false);
        expect(s.activeClass).toBeNull();
        expect(s.classPermissions).toBeNull();
        expect(s.role).toBeNull();
        expect(s.classRole).toBeNull();
        expect(s.help).toBe(false);
        expect(s.break).toBe(false);
        expect(s.pogMeter).toBe(0);
        expect(s.pollRes).toEqual({ buttonRes: "", textRes: "", time: null });
    });

    it("uses provided values when all arguments are given", () => {
        const s = new Student(
            "x@y.com", 42, 5, "apiKey",
            ["poll1"], ["poll2"], ["tag1", "tag2"], "Alice", true
        );
        expect(s.email).toBe("x@y.com");
        expect(s.id).toBe(42);
        expect(s.permissions).toBe(5);
        expect(s.API).toBe("apiKey");
        expect(s.ownedPolls).toEqual(["poll1"]);
        expect(s.sharedPolls).toEqual(["poll2"]);
        expect(s.tags).toEqual(["tag1", "tag2"]);
        expect(s.displayName).toBe("Alice");
        expect(s.isGuest).toBe(true);
    });
});

describe("createStudentFromUserData()", () => {
    it("creates student with correct email, id, and permissions", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 7, permissions: 3,
            API: "k", displayName: "U",
        });
        expect(s.email).toBe("u@test.com");
        expect(s.id).toBe(7);
        expect(s.permissions).toBe(3);
        expect(s).toBeInstanceOf(Student);
    });

    it("sets activeClass from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, activeClass: 99,
        });
        expect(s.activeClass).toBe(99);
    });

    it("sets classPermissions from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, classPermissions: 4,
        });
        expect(s.classPermissions).toBe(4);
    });

    it("sets role and classRole from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, role: "teacher", classRole: "helper",
        });
        expect(s.role).toBe("teacher");
        expect(s.classRole).toBe("helper");
    });

    it("normalizes tags from comma-separated string", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, tags: " math , science , ",
        });
        expect(s.tags).toEqual(["math", "science"]);
    });

    it("normalizes tags from array", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, tags: [" art ", "music"],
        });
        expect(s.tags).toEqual(["art", "music"]);
    });

    it("normalizes null tags to empty array", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, tags: null,
        });
        expect(s.tags).toEqual([]);
    });

    it("parses ownedPolls from JSON string", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1,
            ownedPolls: JSON.stringify(["p1", "p2"]),
        });
        expect(s.ownedPolls).toEqual(["p1", "p2"]);
    });

    it("parses sharedPolls from JSON string", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1,
            sharedPolls: JSON.stringify(["s1"]),
        });
        expect(s.sharedPolls).toEqual(["s1"]);
    });

    it("passes through ownedPolls when already an array", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, ownedPolls: ["a"],
        });
        expect(s.ownedPolls).toEqual(["a"]);
    });

    it("returns empty array for invalid JSON in ownedPolls", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, ownedPolls: "not-json",
        });
        expect(s.ownedPolls).toEqual([]);
    });

    it("sets isGuest from options.isGuest", () => {
        const s = createStudentFromUserData(
            { email: "u@test.com", id: 1 },
            { isGuest: true }
        );
        expect(s.isGuest).toBe(true);
    });

    it("falls back to userData.isGuest when options.isGuest is not set", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, isGuest: true,
        });
        expect(s.isGuest).toBe(true);
    });

    it("copies verified property when present", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, verified: 1,
        });
        expect(s.verified).toBe(1);
    });

    it("does not set verified when absent", () => {
        const s = createStudentFromUserData({ email: "u@test.com", id: 1 });
        expect(s).not.toHaveProperty("verified");
    });

    it("merges pollRes when provided", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1,
            pollRes: { buttonRes: "A", textRes: "yes" },
        });
        expect(s.pollRes).toEqual({ buttonRes: "A", textRes: "yes", time: null });
    });

    it("sets help and break from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, help: true, break: true,
        });
        expect(s.help).toBe(true);
        expect(s.break).toBe(true);
    });

    it("sets pogMeter from userData", () => {
        const s = createStudentFromUserData({
            email: "u@test.com", id: 1, pogMeter: 42,
        });
        expect(s.pogMeter).toBe(42);
    });
});

describe("getStudentsInClass()", () => {
    it("returns students keyed by email with classPermissions and classRole", async () => {
        const user = await seedUser({ email: "stu@test.com" });
        await seedClassUser(10, user.id, { permissions: 3, role: "helper" });

        const result = await getStudentsInClass(10);
        expect(result["stu@test.com"]).toBeDefined();

        const s = result["stu@test.com"];
        expect(s).toBeInstanceOf(Student);
        expect(s.email).toBe("stu@test.com");
        expect(s.id).toBe(user.id);
        expect(s.classPermissions).toBe(3);
        expect(s.classRole).toBe("helper");
    });

    it("returns empty object when no students are in the class", async () => {
        const result = await getStudentsInClass(999);
        expect(result).toEqual({});
    });

    it("returns multiple students in the same class", async () => {
        const u1 = await seedUser({ email: "a@test.com" });
        const u2 = await seedUser({ email: "b@test.com" });
        await seedClassUser(20, u1.id);
        await seedClassUser(20, u2.id);

        const result = await getStudentsInClass(20);
        expect(Object.keys(result)).toHaveLength(2);
        expect(result["a@test.com"]).toBeDefined();
        expect(result["b@test.com"]).toBeDefined();
    });

    it("does not include students from a different class", async () => {
        const u1 = await seedUser({ email: "in@test.com" });
        const u2 = await seedUser({ email: "out@test.com" });
        await seedClassUser(30, u1.id);
        await seedClassUser(31, u2.id);

        const result = await getStudentsInClass(30);
        expect(Object.keys(result)).toHaveLength(1);
        expect(result["in@test.com"]).toBeDefined();
    });
});

describe("getIdFromEmail()", () => {
    it("returns id from classStateStore when user is loaded", () => {
        mockUsers["cached@test.com"] = { id: 55, email: "cached@test.com" };
        const result = getIdFromEmail("cached@test.com");
        expect(result).toBe(55);
        expect(classStateStore.getUser).toHaveBeenCalledWith("cached@test.com");
    });

    it("falls back to DB query when user not in memory", async () => {
        const user = await seedUser({ email: "db@test.com" });
        const id = await getIdFromEmail("db@test.com");
        expect(id).toBe(user.id);
    });

    it("returns undefined when classStateStore.getUser throws", () => {
        // The outer try/catch swallows the error and returns undefined
        classStateStore.getUser.mockImplementationOnce(() => {
            throw new Error("store failure");
        });
        const result = getIdFromEmail("nobody@test.com");
        expect(result).toBeUndefined();
    });
});

describe("getEmailFromId()", () => {
    it("returns email from classStateStore when user is loaded", async () => {
        mockUsers["mem@test.com"] = { id: 77, email: "mem@test.com" };
        const email = await getEmailFromId(77);
        expect(email).toBe("mem@test.com");
        expect(classStateStore.getAllUsers).toHaveBeenCalled();
    });

    it("falls back to DB query when user not in memory", async () => {
        const user = await seedUser({ email: "dbfb@test.com" });
        const email = await getEmailFromId(user.id);
        expect(email).toBe("dbfb@test.com");
    });

    it("returns null when user does not exist anywhere", async () => {
        const email = await getEmailFromId(99999);
        expect(email).toBeNull();
    });
});
