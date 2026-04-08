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

jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn().mockResolvedValue(),
    emitToUser: jest.fn().mockResolvedValue(),
    managerUpdate: jest.fn().mockResolvedValue(),
    userUpdateSocket: jest.fn(),
    setClassOfApiSockets: jest.fn(),
    setClassOfUserSockets: jest.fn(),
    invalidateClassPollCache: jest.fn(),
}));

jest.mock("../../../../sockets/init", () => ({
    userSocketUpdates: new Map(),
}));

jest.mock("@modules/web-server", () => ({
    io: { to: () => ({ emit: jest.fn() }) },
}));

jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        getUserSocketsByEmail: jest.fn().mockReturnValue(null),
    },
}));

const { classStateStore, Classroom } = require("@services/classroom-service");
const { TEACHER_PERMISSIONS, MANAGER_PERMISSIONS, MOD_PERMISSIONS } = require("@modules/permissions");

const joinController = require("../class/enroll");
const leaveController = require("../class/unenroll");
const deleteController = require("../class/delete");
const tagsController = require("../class/tags");
const linksController = require("../class/links/links");
const addLinkController = require("../class/links/add");
const changeLinkController = require("../class/links/change");
const removeLinkController = require("../class/links/remove");
const bannedController = require("../class/banned");
const createClassController = require("../class/create");
const joinClassController = require("../class/join");

const app = createTestApp(
    joinController,
    leaveController,
    deleteController,
    tagsController,
    linksController,
    addLinkController,
    changeLinkController,
    removeLinkController,
    bannedController,
    createClassController,
    joinClassController
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

/**
 * Helper: creates a classroom row in the DB and loads it into classStateStore.
 * Returns the classroom id.
 */
async function seedClassroom(ownerId, { key = "TEST1", className = "Test Class" } = {}) {
    await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key, settings) VALUES (?, ?, ?, ?)", [className, ownerId, key, JSON.stringify({})]);
    const row = await mockDatabase.dbGet("SELECT * FROM classroom WHERE key = ?", [key]);
    const classroom = new Classroom({
        id: row.id,
        className: row.name,
        key: row.key,
        owner: row.owner,
        permissions: null,
        tags: null,
        settings: null,
    });
    classStateStore.setClassroom(row.id, classroom);
    return row.id;
}

/**
 * Helper: enrolls a user in a classroom (DB + in-memory).
 * classPermissions should be a numeric permission level.
 */
async function enrollUserInClass(user, classId, classPermissions = MOD_PERMISSIONS) {
    await mockDatabase.dbRun("INSERT INTO classusers (studentId, classId, permissions) VALUES (?, ?, ?)", [user.id, classId, classPermissions]);

    const student = classStateStore.getUser(user.email);
    if (student) {
        student.activeClass = classId;
        student.classPermissions = classPermissions;
        classStateStore.setClassroomStudent(classId, user.email, student);
    }
}

// POST /api/v1/class/enroll/:code
describe("POST /api/v1/class/enroll/:code", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/enroll/TESTCODE");
        expect(res.status).toBe(401);
    });

    it("returns 404 when the room code does not exist", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);
        const res = await request(app).post("/api/v1/class/enroll/BADCODE").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(404);
    });
});

// POST /api/v1/class/:id/unenroll
describe("POST /api/v1/class/:id/unenroll", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/unenroll");
        expect(res.status).toBe(401);
    });
});

// DELETE /api/v1/class/:id
describe("DELETE /api/v1/class/:id", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/class/1");
        expect(res.status).toBe(401);
    });

    it("returns 403 when user is not the owner and lacks admin scope", async () => {
        const { tokens: ownerTokens, user: owner } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            displayName: "Owner",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(owner.id);

        const { tokens: otherTokens, user: otherUser } = await seedAuthenticatedUser(mockDatabase, {
            email: "other@example.com",
            displayName: "Other",
            permissions: TEACHER_PERMISSIONS,
        });

        const res = await request(app).delete(`/api/v1/class/${classId}`).set("Authorization", `Bearer ${otherTokens.accessToken}`);
        expect(res.status).toBe(403);
    });

    it("returns 200 when the room owner deletes the room", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);

        const res = await request(app).delete(`/api/v1/class/${classId}`).set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const deleted = await mockDatabase.dbGet("SELECT * FROM classroom WHERE id = ?", [classId]);
        expect(deleted).toBeUndefined();
    });

    it("returns 200 when a manager deletes any room", async () => {
        const { user: owner } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            displayName: "Owner",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(owner.id);

        const { tokens: managerTokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "manager@example.com",
            displayName: "Manager",
            permissions: MANAGER_PERMISSIONS,
        });

        const res = await request(app).delete(`/api/v1/class/${classId}`).set("Authorization", `Bearer ${managerTokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it("returns 404 when the room does not exist", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "owner@example.com",
            permissions: MANAGER_PERMISSIONS,
        });

        const res = await request(app).delete("/api/v1/class/99999").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(404);
    });
});

describe("GET /api/v1/class/tags", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/tags");
        expect(res.status).toBe(401);
    });

    it("returns 404 when user has no active class", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase);
        const res = await request(app).get("/api/v1/class/tags").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(404);
    });

    it("returns 200 with tags for an active class", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        // Set activeClass on the user in classStateStore
        classStateStore.updateUser(user.email, { activeClass: classId });

        const res = await request(app).get("/api/v1/class/tags").set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.tags)).toBe(true);
    });
});

describe("PUT /api/v1/room/tags", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app)
            .put("/api/v1/class/tags")
            .send({ tags: ["math"] });
        expect(res.status).toBe(401);
    });

    it("returns 403 when user lacks class.tags.manage scope", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "student@example.com",
            permissions: 2,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, 2); // student-level class perms
        classStateStore.updateUser(user.email, { activeClass: classId });

        const res = await request(app)
            .put("/api/v1/class/tags")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ tags: ["math"] });
        expect(res.status).toBe(403);
    });
});

describe("GET /api/v1/room/:id/links", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/links");
        expect(res.status).toBe(401);
    });

    it("returns 200 with links when user has class.links.read scope", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        // Insert a link
        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "Course Website", "https://example.com"]);

        const res = await request(app).get(`/api/v1/class/${classId}/links`).set("Authorization", `Bearer ${tokens.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.links)).toBe(true);
        expect(res.body.data.links).toHaveLength(1);
        expect(res.body.data.links[0]).toMatchObject({ name: "Course Website", url: "https://example.com" });
    });
});

describe("POST /api/v1/room/:id/links/add", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).post("/api/v1/class/1/links/add").send({ name: "Link", url: "https://example.com" });
        expect(res.status).toBe(401);
    });

    it("returns 200 when a teacher adds a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/links/add`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "Docs", url: "https://docs.example.com" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const link = await mockDatabase.dbGet("SELECT * FROM links WHERE classId = ?", [classId]);
        expect(link).toBeDefined();
        expect(link.name).toBe("Docs");
    });

    it("returns 400 when name or url is missing", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        const res = await request(app)
            .post(`/api/v1/class/${classId}/links/add`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "Missing URL" });
        expect(res.status).toBe(400);
    });
});

describe("PUT /api/v1/room/:id/links", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).put("/api/v1/class/1/links").send({ name: "Link", url: "https://example.com" });
        expect(res.status).toBe(401);
    });

    it("returns 200 when a teacher updates a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "Old Link", "https://old.example.com"]);

        const res = await request(app)
            .put(`/api/v1/class/${classId}/links`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ oldName: "Old Link", name: "New Link", url: "https://new.example.com" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe("DELETE /api/v1/room/:id/links", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).delete("/api/v1/class/1/links").send({ name: "Link" });
        expect(res.status).toBe(401);
    });

    it("returns 200 when a teacher removes a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "ToRemove", "https://remove.example.com"]);

        const res = await request(app)
            .delete(`/api/v1/class/${classId}/links`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "ToRemove" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const link = await mockDatabase.dbGet("SELECT * FROM links WHERE classId = ? AND name = ?", [classId, "ToRemove"]);
        expect(link).toBeUndefined();
    });

    it("returns 400 when name is missing", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        const res = await request(app).delete(`/api/v1/class/${classId}/links`).set("Authorization", `Bearer ${tokens.accessToken}`).send({});
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// Deprecated endpoints
// ---------------------------------------------------------------------------

// POST /api/v1/room/tags (deprecated, use PUT)
describe("POST /api/v1/room/tags (deprecated)", () => {
    it("returns 200 with deprecation headers when a teacher sets tags", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);
        classStateStore.updateUser(user.email, { activeClass: classId });

        const res = await request(app)
            .post("/api/v1/room/tags")
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ tags: ["science"] });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});

// POST /api/v1/room/:id/links/change (deprecated, use PUT)
describe("POST /api/v1/room/:id/links/change (deprecated)", () => {
    it("returns 200 with deprecation headers when a teacher changes a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "Old", "https://old.example.com"]);

        const res = await request(app)
            .post(`/api/v1/room/${classId}/links/change`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ oldName: "Old", name: "New", url: "https://new.example.com" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});

// POST /api/v1/room/:id/links/remove (deprecated, use DELETE)
describe("POST /api/v1/room/:id/links/remove (deprecated)", () => {
    it("returns 200 with deprecation headers when a teacher removes a link", async () => {
        const { tokens, user } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });
        const classId = await seedClassroom(user.id);
        await enrollUserInClass(user, classId, TEACHER_PERMISSIONS);

        await mockDatabase.dbRun("INSERT INTO links (classId, name, url) VALUES (?, ?, ?)", [classId, "ToRemove", "https://remove.example.com"]);

        const res = await request(app)
            .post(`/api/v1/room/${classId}/links/remove`)
            .set("Authorization", `Bearer ${tokens.accessToken}`)
            .send({ name: "ToRemove" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers["x-deprecated"]).toBeDefined();
        expect(res.headers["warning"]).toMatch(/299/);
    });
});

// GET /api/v1/class/:id/banned
describe("GET /api/v1/class/:id/banned", () => {
    it("returns 401 without authentication", async () => {
        const res = await request(app).get("/api/v1/class/1/banned");
        expect(res.status).toBe(401);
    });

    it("returns 403 when class not in classStateStore", async () => {
        const { tokens } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            permissions: TEACHER_PERMISSIONS,
        });

        const res = await request(app).get("/api/v1/class/9999/banned").set("Authorization", `Bearer ${tokens.accessToken}`);

        expect(res.status).toBe(403);
    });

    it("returns 200 with empty array when no banned users", async () => {
        const { tokens: teacherTokens, user: teacher } = await seedAuthenticatedUser(mockDatabase, {
            email: "teacher@example.com",
            displayName: "Teacher",
            permissions: TEACHER_PERMISSIONS,
        });

        const createRes = await request(app)
            .post("/api/v1/class/create")
            .set("Authorization", `Bearer ${teacherTokens.accessToken}`)
            .send({ name: "Banned Test Class" });
        const classId = createRes.body.data.classId;

        // Teacher joins the class so they are in classStateStore
        await request(app).post(`/api/v1/class/${classId}/join`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        const res = await request(app).get(`/api/v1/class/${classId}/banned`).set("Authorization", `Bearer ${teacherTokens.accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data).toHaveLength(0);
    });
});
