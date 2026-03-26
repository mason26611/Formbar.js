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
const settingsController = require("../class/settings");
const permissionsController = require("../class/permissions");

const app = createTestApp(createController, joinController, settingsController, permissionsController);

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

    // Teacher must join so they appear in classroom.students (required by hasClassScope)
    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

    const { tokens: studentTokens, user: student } = await seedAuthenticatedUser(mockDatabase, {
        email: "student@test.com",
        displayName: "Student1",
        permissions: 2,
    });

    await mockDatabase.dbRun("INSERT INTO classusers(classId, studentId, permissions) VALUES(?, ?, ?)", [classId, student.id, 2]);

    await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${studentTokens.accessToken}`);

    return { classId, teacherTokens, studentTokens, teacher, student };
}

describe("PATCH /api/v1/class/:id/settings", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).patch("/api/v1/class/1/settings").send({ setting: "mute", value: true });
        expect(res.status).toBe(401);
    });

    it("returns 403 when user lacks class.session.settings scope", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/settings`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({ setting: "mute", value: true });

        expect(res.status).toBe(403);
    });

    it("returns 400 when setting is missing", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/settings`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ value: true });

        expect(res.status).toBe(400);
    });

    it("returns 400 when value is missing", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/settings`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ setting: "mute" });

        expect(res.status).toBe(400);
    });

    it("returns 400 for an invalid setting key", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/settings`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ setting: "nonExistent", value: true });

        expect(res.status).toBe(400);
    });

    it("updates mute setting successfully", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/settings`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ setting: "mute", value: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify setting persisted to DB
        const row = await mockDatabase.dbGet("SELECT settings FROM classroom WHERE id = ?", [classId]);
        const settings = JSON.parse(row.settings);
        expect(settings.mute).toBe(true);
    });

    it("updates filter setting successfully", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/settings`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ setting: "filter", value: "test-filter" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("updates isExcluded setting successfully", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const newExcluded = { guests: true, mods: false, teachers: true };
        const res = await request(app)
            .patch(`/api/v1/class/${classId}/settings`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ setting: "isExcluded", value: newExcluded });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const row = await mockDatabase.dbGet("SELECT settings FROM classroom WHERE id = ?", [classId]);
        const settings = JSON.parse(row.settings);
        expect(settings.isExcluded).toEqual(newExcluded);
    });
});

describe("PATCH /api/v1/class/:id/permissions", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).patch("/api/v1/class/1/permissions").send({ permission: "controlPoll", level: 3 });
        expect(res.status).toBe(401);
    });

    it("returns 403 when user lacks class.session.settings scope", async () => {
        const { classId, studentTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${studentTokens.accessToken}`)
            .send({ permission: "controlPoll", level: 3 });

        expect(res.status).toBe(403);
    });

    it("returns 400 when permission is missing", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ level: 3 });

        expect(res.status).toBe(400);
    });

    it("returns 400 when level is missing", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ permission: "controlPoll" });

        expect(res.status).toBe(400);
    });

    it("returns 400 for an invalid permission key", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ permission: "fakePermission", level: 3 });

        expect(res.status).toBe(400);
    });

    it("returns 400 for a level below 1", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ permission: "controlPoll", level: 0 });

        expect(res.status).toBe(400);
    });

    it("returns 400 for a level above 5", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ permission: "controlPoll", level: 6 });

        expect(res.status).toBe(400);
    });

    it("returns 400 for a non-integer level", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ permission: "controlPoll", level: 2.5 });

        expect(res.status).toBe(400);
    });

    it("updates a permission threshold successfully", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const res = await request(app)
            .patch(`/api/v1/class/${classId}/permissions`)
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ permission: "controlPoll", level: 2 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify persisted in DB
        const row = await mockDatabase.dbGet("SELECT controlPoll FROM class_permissions WHERE classId = ?", [classId]);
        expect(row.controlPoll).toBe(2);
    });

    it("updates different permission keys", async () => {
        const { classId, teacherTokens } = await setupClassWithStudent();

        const permissions = ["links", "manageStudents", "breakHelp", "manageClass", "auxiliary", "userDefaults", "seePoll", "votePoll"];
        for (const permission of permissions) {
            const res = await request(app)
                .patch(`/api/v1/class/${classId}/permissions`)
                .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
                .send({ permission, level: 1 });

            expect(res.status).toBe(200);
        }
    });
});
