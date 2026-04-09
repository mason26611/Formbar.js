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

const mockClassrooms = {};
const mockUsers = {};
jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getClassroom: jest.fn((id) => mockClassrooms[id] || null),
        setClassroom: jest.fn((id, c) => {
            mockClassrooms[id] = c;
        }),
        getUser: jest.fn((email) => mockUsers[email] || null),
        setUser: jest.fn((email, u) => {
            mockUsers[email] = u;
        }),
        setClassroomStudent: jest.fn((classId, email, student) => {
            if (mockClassrooms[classId]) {
                mockClassrooms[classId].students[email] = student;
            }
        }),
    },
    Classroom: jest.fn(),
}));

const {
    addStudentRole,
    removeStudentRole,
    getStudentRoles,
    getActingUser,
    getClassRoles,
    createClassRole,
    updateClassRole,
    deleteClassRole,
} = require("@services/role-service");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    jest.clearAllMocks();
    for (const k of Object.keys(mockClassrooms)) delete mockClassrooms[k];
    for (const k of Object.keys(mockUsers)) delete mockUsers[k];
});

afterAll(async () => {
    await mockDatabase.close();
});

let seedCounter = 0;
async function seedUser(overrides = {}) {
    seedCounter += 1;
    const defaults = {
        email: `user${seedCounter}@test.com`,
        password: "hashed",
        API: `api-${seedCounter}-${Date.now()}`,
        secret: `sec-${seedCounter}-${Date.now()}`,
        displayName: `User_${seedCounter}`,
        digipogs: 0,
        pin: null,
        verified: 0,
    };
    const u = { ...defaults, ...overrides };
    const id = await mockDatabase.dbRun(
        "INSERT INTO users (email, password, API, secret, displayName, digipogs, pin, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [u.email, u.password, u.API, u.secret, u.displayName, u.digipogs, u.pin, u.verified]
    );
    // Assign global role (default: Student=3)
    const roleId = u.globalRoleId || 3;
    await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [id, roleId]);
    return { id, ...u };
}

async function seedClass(ownerId) {
    const classId = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key) VALUES (?, ?, ?)", ["TestClass", ownerId, 123456]);
    return classId;
}

async function seedClassUser(classId, studentId, overrides = {}) {
    const defaults = { digiPogs: 0 };
    const cu = { ...defaults, ...overrides };
    await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId, digiPogs) VALUES (?, ?, ?)", [classId, studentId, cu.digiPogs]);
}

function setupMockClassroom(classId, ownerId, students = {}) {
    mockClassrooms[classId] = {
        classId,
        owner: ownerId,
        students,
        customRoles: {},
        roleOverrides: {},
    };
}

async function getRoleIdByName(roleName, classId = null) {
    const row =
        classId == null
            ? await mockDatabase.dbGet("SELECT id FROM roles WHERE name = ? AND classId IS NULL", [roleName])
            : await mockDatabase.dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [roleName, classId]);

    return row ? row.id : null;
}

// ── getActingUser ──

describe("getActingUser()", () => {
    it("returns null when classroom is null", () => {
        expect(getActingUser(null, { email: "a@b.com", id: 1 })).toBeNull();
    });

    it("returns the student when found in students map", () => {
        const student = { email: "a@b.com", classRoles: ["Student"], classRole: "Student" };
        const classroom = { students: { "a@b.com": student }, owner: 99 };
        expect(getActingUser(classroom, { email: "a@b.com", id: 1 })).toBe(student);
    });

    it("returns synthetic owner context for class owner not in students map", () => {
        const classroom = { students: {}, owner: 5 };
        const result = getActingUser(classroom, { email: "owner@test.com", id: 5 });
        expect(result).toEqual({
            id: 5,
            email: "owner@test.com",
            globalRoles: [],
            classRoles: [],
            classRoleRefs: [],
            classRole: null,
            isClassOwner: true,
        });
    });

    it("returns synthetic owner context when owner matched by email", () => {
        const classroom = { students: {}, owner: "owner@test.com" };
        const result = getActingUser(classroom, { email: "owner@test.com", id: 5 });
        expect(result).toEqual({
            id: 5,
            email: "owner@test.com",
            globalRoles: [],
            classRoles: [],
            classRoleRefs: [],
            classRole: null,
            isClassOwner: true,
        });
    });

    it("returns null for non-member non-owner", () => {
        const classroom = { students: {}, owner: 99 };
        expect(getActingUser(classroom, { email: "stranger@test.com", id: 1 })).toBeNull();
    });

    it("prefers student match over owner fallback", () => {
        const student = { email: "owner@test.com", classRoles: ["Student"] };
        const classroom = { students: { "owner@test.com": student }, owner: 5 };
        const result = getActingUser(classroom, { email: "owner@test.com", id: 5 });
        expect(result).toBe(student);
    });
});

// ── getStudentRoles ──

describe("getStudentRoles()", () => {
    it("returns empty array when no roles assigned", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toEqual([]);
    });

    it("returns assigned role names", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const modRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Mod' AND classId IS NULL");
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toEqual(["Mod"]);
    });

    it("returns multiple roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        const modRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Mod' AND classId IS NULL");
        const studentRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Student' AND classId IS NULL");
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, studentRole.id, classId]);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toContain("Mod");
        expect(roles).toContain("Student");
        expect(roles).toHaveLength(2);
    });
});

// ── createClassRole ──

describe("createClassRole()", () => {
    it("creates a custom role with the provided color", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        setupMockClassroom(classId, user.id, {});

        const actingUser = { classRoles: ["Manager"], classRole: "Manager" };
        const classroom = mockClassrooms[classId];

        const role = await createClassRole(classId, "Helper", ["class.poll.create"], actingUser, classroom, "#123456");

        expect(role.name).toBe("Helper");
        expect(role.scopes).toEqual(["class.poll.create"]);
        expect(role.color).toBe("#123456");

        const row = await mockDatabase.dbGet("SELECT color FROM roles WHERE id = ?", [role.id]);
        expect(row.color).toBe("#123456");
    });

    it("defaults custom role color to #808080 when omitted", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        setupMockClassroom(classId, user.id, {});

        const actingUser = { classRoles: ["Manager"], classRole: "Manager" };
        const classroom = mockClassrooms[classId];

        const role = await createClassRole(classId, "DefaultColorRole", ["class.poll.create"], actingUser, classroom);

        expect(role.color).toBe("#808080");
    });
});

// ── addStudentRole ──

describe("addStudentRole()", () => {
    it("adds a built-in role to a student", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { classRoles: [], classRole: null },
        });
        const modRoleId = await getRoleIdByName("Mod");

        await addStudentRole(classId, user.id, modRoleId);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toContain("Mod");
    });

    it("updates in-memory classRoles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { classRoles: [], classRole: null },
        });
        const modRoleId = await getRoleIdByName("Mod");

        await addStudentRole(classId, user.id, modRoleId);

        const student = mockClassrooms[classId].students[user.email];
        expect(student.classRoles).toContain("Mod");
    });

    it("throws ValidationError for Guest role", async () => {
        const guestRoleId = await getRoleIdByName("Guest");
        await expect(addStudentRole(1, 1, guestRoleId)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for non-existent role", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        await expect(addStudentRole(classId, user.id, 999999)).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when user is not a class member", async () => {
        const owner = await seedUser();
        const nonMember = await seedUser();
        const classId = await seedClass(owner.id);
        const modRoleId = await getRoleIdByName("Mod");

        await expect(addStudentRole(classId, nonMember.id, modRoleId)).rejects.toThrow(NotFoundError);
    });

    it("throws ValidationError for duplicate role assignment", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { classRoles: [], classRole: null },
        });
        const modRoleId = await getRoleIdByName("Mod");

        await addStudentRole(classId, user.id, modRoleId);
        await expect(addStudentRole(classId, user.id, modRoleId)).rejects.toThrow(ValidationError);
    });

    it("adds a custom role to a student", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        const helperRoleId = await mockDatabase.dbRun("INSERT INTO roles (name, classId, scopes) VALUES (?, ?, ?)", [
            "Helper",
            classId,
            '["class.poll.create"]',
        ]);
        setupMockClassroom(classId, user.id, {
            [user.email]: { classRoles: [], classRole: null },
        });
        mockClassrooms[classId].customRoles = { Helper: ["class.poll.create"] };

        await addStudentRole(classId, user.id, helperRoleId);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toContain("Helper");
    });

    it("throws ForbiddenError for privilege escalation", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id);

        const actingUser = { classRoles: ["Student"], classRole: "Student" };
        const classroom = mockClassrooms[classId];
        const teacherRoleId = await getRoleIdByName("Teacher");

        await expect(addStudentRole(classId, user.id, teacherRoleId, actingUser, classroom)).rejects.toThrow(ForbiddenError);
    });
});

// ── removeStudentRole ──

describe("removeStudentRole()", () => {
    it("removes an assigned role", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { classRoles: ["Mod"], classRole: "Mod" },
        });

        await getClassRoles(classId);
        const modRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Mod' AND classId = ?", [classId]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);

        await removeStudentRole(classId, user.id, modRole.id);

        const roles = await getStudentRoles(classId, user.id);
        expect(roles).toEqual([]);
    });

    it("updates in-memory classRoles after removal", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        setupMockClassroom(classId, user.id, {
            [user.email]: { classRoles: ["Mod"], classRole: "Mod" },
        });

        await getClassRoles(classId);
        const modRole = await mockDatabase.dbGet("SELECT id FROM roles WHERE name = 'Mod' AND classId = ?", [classId]);
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [user.id, modRole.id, classId]);

        await removeStudentRole(classId, user.id, modRole.id);

        const student = mockClassrooms[classId].students[user.email];
        expect(student.classRoles).not.toContain("Mod");
    });

    it("throws ValidationError for Guest role", async () => {
        const guestRoleId = await getRoleIdByName("Guest");
        await expect(removeStudentRole(1, 1, guestRoleId)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when role is not assigned", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);
        const modRoleId = await getRoleIdByName("Mod");

        await expect(removeStudentRole(classId, user.id, modRoleId)).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for non-existent role", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await seedClassUser(classId, user.id);

        await expect(removeStudentRole(classId, user.id, 999999)).rejects.toThrow(ValidationError);
    });
});

// ── getClassRoles ──

describe("getClassRoles()", () => {
    it("returns default roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        const names = roles.map((r) => r.name);
        expect(names).toContain("Guest");
        expect(names).toContain("Student");
        expect(names).toContain("Mod");
        expect(names).toContain("Teacher");
        expect(names).toContain("Manager");
        expect(names).toContain("Banned");
    });

    it("includes custom roles for the class", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await mockDatabase.dbRun("INSERT INTO roles (name, classId, scopes) VALUES (?, ?, ?)", ["Helper", classId, '["class.poll.create"]']);

        const roles = await getClassRoles(classId);
        const custom = roles.find((r) => r.name === "Helper");
        expect(custom).toBeDefined();
        expect(custom.scopes).toEqual(["class.poll.create"]);
    });

    it("returns role ids for class roles", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        expect(roles.length).toBeGreaterThanOrEqual(6);
        roles.forEach((r) => expect(typeof r.id).toBe("number"));
    });

    it("allows updating default role scopes in a class", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);

        const roles = await getClassRoles(classId);
        const teacherRole = roles.find((r) => r.name === "Teacher");
        expect(teacherRole).toBeDefined();

        await updateClassRole(
            teacherRole.id,
            classId,
            { scopes: ["class.poll.read"] },
            { classRoles: ["Manager"], classRole: "Manager" },
            { customRoles: {} }
        );

        const updatedRoles = await getClassRoles(classId);
        const updatedTeacher = updatedRoles.find((r) => r.name === "Teacher");
        expect(updatedTeacher.scopes).toEqual(["class.poll.read"]);
    });

    it("returns custom role colors", async () => {
        const user = await seedUser();
        const classId = await seedClass(user.id);
        await mockDatabase.dbRun("INSERT INTO roles (name, classId, scopes, color) VALUES (?, ?, ?, ?)", [
            "Helper",
            classId,
            '["class.poll.create"]',
            "#123456",
        ]);

        const roles = await getClassRoles(classId);
        const custom = roles.find((r) => r.name === "Helper");
        expect(custom.color).toBe("#123456");
    });
});
