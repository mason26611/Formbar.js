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
const joinController = require("../class/join");
const permissionsController = require("../class/permissions");

const app = createTestApp(createController, joinController, permissionsController);

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

async function setupClassWithStudent() {
    const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
        email: "teacher@test.com",
        displayName: "Teacher",
        permissions: 4,
    });

    const createRes = await request(app)
        .post("/api/v1/class/create")
        .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
        .send({ name: "Test Class" });
    const classId = createRes.body.data.classId;

    const { tokens: studentTokens, user: student } = await seedAuthenticatedUser(mockDatabase, {
        email: "student@test.com",
        displayName: "Student1",
        permissions: 2,
    });

    await mockDatabase.dbRun("INSERT INTO classusers(classId, studentId, permissions) VALUES(?, ?, ?)", [classId, student.id, 2]);

    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

    return { classId, teacherTokens, studentTokens, teacher, student };
}

// ---------------------------------------------------------------------------
// GET /api/v1/class/:id/permissions
// ---------------------------------------------------------------------------
describe("GET /api/v1/class/:id/permissions", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/permissions");
        expect(res.status).toBe(401);
    });

    it("returns 404 when class not started", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);

        const res = await request(app).get("/api/v1/class/9999/permissions").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 when user not in the class", async () => {
        const { classId } = await setupClassWithStudent();

        const { tokens: outsiderTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "outsider@test.com",
            displayName: "Outsider",
            permissions: 2,
        });

        const res = await request(app).get(`/api/v1/class/${classId}/permissions`).set("Authorization", `Bearer ${outsiderTokens.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns 200 with permissions for a class member", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app).get(`/api/v1/class/${classId}/permissions`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
    });
});
