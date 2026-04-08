const request = require("supertest");
const { createTestDb } = require("@test-helpers/db");
const { createTestApp, seedAuthenticatedUser, clearClassStateStore } = require("./helpers/test-app");

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

jest.mock("@modules/config", () => {
    const crypto = require("crypto");
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return {
        settings: { emailEnabled: false, googleOauthEnabled: false },
        publicKey,
        privateKey,
        frontendUrl: "http://localhost:3000",
    };
});

jest.mock("@modules/web-server", () => ({
    io: { to: () => ({ emit: jest.fn() }) },
}));

jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn(),
    emitToUser: jest.fn(),
    setClassOfApiSockets: jest.fn(),
    setClassOfUserSockets: jest.fn(),
    userUpdateSocket: jest.fn(),
    invalidateClassPollCache: jest.fn(),
}));

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        getUserSocketsByEmail: jest.fn().mockReturnValue(null),
    },
}));

const createController = require("../class/create");
const classController = require("../class/class");
const joinController = require("../class/join");
const leaveController = require("../class/leave");
const startController = require("../class/start");
const endController = require("../class/end");
const studentsController = require("../class/students");
const activeController = require("../class/active");

const app = createTestApp(
    createController,
    classController,
    joinController,
    leaveController,
    startController,
    endController,
    studentsController,
    activeController
);

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    clearClassStateStore();
});

afterAll(async () => {
    await mockDatabase.close();
});

async function createClassAsTeacher(tokens, name = "Test Class") {
    const res = await request(app).post("/api/v1/class/create").set("Authorization", `Bearer ${tokens.accessToken}`).send({ name });
    return res;
}

describe("POST /api/v1/class/create", () => {
    it("returns 200 and creates a class when called by a teacher", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await createClassAsTeacher(tokens, "Math 101");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("classId");
        expect(res.body.data).toHaveProperty("key");
        expect(res.body.data.className).toBe("Math 101");
    });

    it("returns 200 when called by a manager (permissions=5)", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "admin@example.com",
            displayName: "Admin1",
            permissions: 5,
        });

        const res = await createClassAsTeacher(tokens, "Admin Class");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("classId");
    });

    it("returns 403 when called by a student (permissions=2)", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "student@example.com",
            displayName: "Student1",
            permissions: 2,
        });

        const res = await createClassAsTeacher(tokens, "Denied Class");

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/create").send({ name: "No Auth Class" });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when name is missing", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher2@example.com",
            displayName: "Teacher2",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/create").set("Authorization", `Bearer ${tokens.accessToken}`).send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it("returns 400 when name is too short", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher3@example.com",
            displayName: "Teacher3",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/create").set("Authorization", `Bearer ${tokens.accessToken}`).send({ name: "ab" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/class/:id", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 when class is not started (not in classStateStore)", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/class/9999").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not in the class", async () => {
        const { classStateStore } = require("@services/classroom-service");
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        // Manually set up a class in classStateStore with no students
        classStateStore.setClassroom(42, {
            classId: 42,
            className: "Restricted Class",
            isActive: true,
            owner: 999,
            students: {},
            key: "ABCD",
            poll: null,
            tags: [],
            settings: {},
            timer: {},
        });

        const res = await request(app).get("/api/v1/class/42").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/join", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/join");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 when a class member joins their class", async () => {
        // Create teacher + class
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const createRes = await createClassAsTeacher(teacherTokens, "Join Test");
        const classId = createRes.body.data.classId;

        // Create a student
        const { tokens: studentTokens, user: student } = await seedAuthenticatedUser(mockDatabase, {
            email: "student@example.com",
            displayName: "Student1",
            permissions: 2,
        });

        // Enroll student in class via DB
        await mockDatabase.dbRun("INSERT INTO classusers(classId, studentId, permissions) VALUES(?, ?, ?)", [classId, student.id, 2]);

        const res = await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 404 when class does not exist", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).post("/api/v1/class/9999/join").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not enrolled in the class", async () => {
        const { tokens: teacherTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const createRes = await createClassAsTeacher(teacherTokens, "No Enroll");
        const classId = createRes.body.data.classId;

        // Create a non-enrolled student
        const { tokens: studentTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "outsider@example.com",
            displayName: "Outsider",
            permissions: 2,
        });

        const res = await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/leave", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/leave");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 when user is not in the specified class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).post("/api/v1/class/9999/leave").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/start", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/start");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not active in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/start").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("POST /api/v1/class/:id/end", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/end");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not active in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await request(app).post("/api/v1/class/9999/end").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/class/:id/students", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/students");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when class is not active in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        const res = await request(app).get("/api/v1/class/9999/students").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

describe("GET /api/v1/class/:id/active", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/active");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user is not a member of the class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/class/9999/active").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with isActive false when class owner checks inactive class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: 4,
        });

        // Create a class so the teacher is the owner in the DB
        // initializeClassroom sets isActive = false by default
        const createRes = await createClassAsTeacher(tokens, "Active Check");
        const classId = createRes.body.data.classId;

        const res = await request(app).get(`/api/v1/class/${classId}/active`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isActive).toBe(false);
    });

    it("returns 200 with isActive true when class is started", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher2@example.com",
            displayName: "Teacher2",
            permissions: 4,
        });

        const createRes = await createClassAsTeacher(tokens, "Active True");
        const classId = createRes.body.data.classId;

        // Mark classroom as active directly
        const { classStateStore } = require("@services/classroom-service");
        const classroom = classStateStore.getClassroom(classId);
        if (classroom) {
            classroom.isActive = true;
        }

        const res = await request(app).get(`/api/v1/class/${classId}/active`).set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isActive).toBe(true);
    });
});
