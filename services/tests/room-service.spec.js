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
    rateLimit: { maxAttempts: 5, lockoutDuration: 900000, minDelayBetweenAttempts: 1000, attemptWindow: 300000 },
}));

jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn(),
    emitToUser: jest.fn(),
}));

const mockClassrooms = {};
jest.mock("@services/classroom-service", () => ({
    classStateStore: {
        getClassroom: jest.fn((id) => mockClassrooms[id] || null),
        removeClassroomStudent: jest.fn(),
        updateUser: jest.fn(),
    },
}));

jest.mock("@services/class-service", () => ({
    initializeClassroom: jest.fn(),
    addUserToClassroomSession: jest.fn(() => true),
}));

jest.mock("@services/student-service", () => ({
    getIdFromEmail: jest.fn(() => 1),
}));

jest.mock("../../sockets/init", () => ({
    userSocketUpdates: new Map(),
}));

const {
    deleteRoom,
    getRoomById,
    roomOwnerCheck,
    joinRoomByCode,
    joinRoom,
    leaveRoom,
    isUserInRoom,
    getLinksInRoom,
} = require("@services/room-service");
const { emitToUser, advancedEmitToClass } = require("@services/socket-updates-service");
const { classStateStore } = require("@services/classroom-service");
const classService = require("@services/class-service");
const { getIdFromEmail } = require("@services/student-service");
const { userSocketUpdates } = require("../../sockets/init");
const AppError = require("@errors/app-error");
const NotFoundError = require("@errors/not-found-error");

async function seedClassroom(overrides = {}) {
    const defaults = { name: "Test Class", owner: 1, key: "ABC123", tags: null, settings: null };
    const c = { ...defaults, ...overrides };
    const id = await mockDatabase.dbRun("INSERT INTO classroom (name, owner, key, tags, settings) VALUES (?, ?, ?, ?, ?)", [
        c.name,
        c.owner,
        c.key,
        c.tags,
        c.settings,
    ]);
    return { id, ...c };
}

async function seedClassUser(classId, studentId, overrides = {}) {
    const defaults = { permissions: null, digiPogs: 0, role: "student" };
    const u = { ...defaults, ...overrides };
    await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId, permissions, digiPogs, role) VALUES (?, ?, ?, ?, ?)", [
        classId,
        studentId,
        u.permissions,
        u.digiPogs,
        u.role,
    ]);
}

async function seedLink(classId, name, url) {
    await mockDatabase.dbRun("INSERT INTO links (name, url, classId) VALUES (?, ?, ?)", [name, url, classId]);
}

beforeAll(async () => {
    mockDatabase = await createTestDb();
});

afterEach(async () => {
    await mockDatabase.reset();
    jest.clearAllMocks();
    Object.keys(mockClassrooms).forEach((k) => delete mockClassrooms[k]);
});

afterAll(async () => {
    await mockDatabase.close();
});

describe("deleteRoom", () => {
    it("deletes classroom and classusers rows", async () => {
        const room = await seedClassroom();
        await seedClassUser(room.id, 1);
        await seedClassUser(room.id, 2);

        await deleteRoom(room.id);

        const classroom = await mockDatabase.dbGet("SELECT * FROM classroom WHERE id=?", [room.id]);
        const users = await mockDatabase.dbGetAll("SELECT * FROM classusers WHERE classId=?", [room.id]);
        expect(classroom).toBeUndefined();
        expect(users).toEqual([]);
    });

    it("throws AppError when roomId is null", async () => {
        await expect(deleteRoom(null)).rejects.toThrow(AppError);
    });

    it("throws AppError when roomId is undefined", async () => {
        await expect(deleteRoom(undefined)).rejects.toThrow(AppError);
    });
});

describe("getRoomById", () => {
    it("returns classroom row when found", async () => {
        const room = await seedClassroom({ name: "My Room", key: "XYZ789" });

        const result = await getRoomById(room.id);

        expect(result).toMatchObject({ id: room.id, name: "My Room", key: "XYZ789", owner: 1 });
    });

    it("returns undefined for non-existent id", async () => {
        const result = await getRoomById(9999);
        expect(result).toBeUndefined();
    });

    it("throws AppError when roomId is null", () => {
        expect(() => getRoomById(null)).toThrow(AppError);
    });
});

describe("roomOwnerCheck", () => {
    it("returns true when user is the owner", async () => {
        const room = await seedClassroom({ owner: 42 });
        const req = { params: { id: String(room.id) }, user: { id: 42 } };

        const result = await roomOwnerCheck(req);

        expect(result).toBe(true);
        expect(req._room).toMatchObject({ id: room.id, owner: 42 });
    });

    it("returns false when user is not the owner", async () => {
        const room = await seedClassroom({ owner: 42 });
        const req = { params: { id: String(room.id) }, user: { id: 99 } };

        const result = await roomOwnerCheck(req);

        expect(result).toBe(false);
    });

    it("throws NotFoundError for non-existent room", async () => {
        const req = { params: { id: "9999" }, user: { id: 1 } };

        await expect(roomOwnerCheck(req)).rejects.toThrow(NotFoundError);
    });

    it("caches room on req._room", async () => {
        const room = await seedClassroom({ owner: 10 });
        const req = { params: { id: String(room.id) }, user: { id: 10 } };

        await roomOwnerCheck(req);

        expect(req._room).toBeDefined();
        expect(req._room.id).toBe(room.id);
        expect(req._room.name).toBe("Test Class");
    });
});

describe("isUserInRoom", () => {
    it("returns true when user is in class", async () => {
        const room = await seedClassroom();
        await seedClassUser(room.id, 5);

        const result = await isUserInRoom(5, room.id);
        expect(result).toBe(true);
    });

    it("returns false when user is not in class", async () => {
        const room = await seedClassroom();

        const result = await isUserInRoom(5, room.id);
        expect(result).toBe(false);
    });

    it("returns false for non-existent class", async () => {
        const result = await isUserInRoom(1, 9999);
        expect(result).toBe(false);
    });
});

describe("getLinksInRoom", () => {
    it("returns links for a class", async () => {
        const room = await seedClassroom();
        await seedLink(room.id, "Google", "https://google.com");
        await seedLink(room.id, "GitHub", "https://github.com");

        const links = await getLinksInRoom(room.id);

        expect(links).toHaveLength(2);
        expect(links).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "Google", url: "https://google.com" }),
                expect.objectContaining({ name: "GitHub", url: "https://github.com" }),
            ])
        );
    });

    it("returns empty array when no links exist", async () => {
        const room = await seedClassroom();

        const links = await getLinksInRoom(room.id);
        expect(links).toEqual([]);
    });

    it("throws AppError when classId is null", () => {
        expect(() => getLinksInRoom(null)).toThrow(AppError);
    });
});

describe("joinRoomByCode", () => {
    it("delegates to class-service on happy path", async () => {
        const room = await seedClassroom({ key: "JOIN1" });
        mockClassrooms[room.id] = { id: room.id };
        const sessionUser = { email: "test@example.com" };

        const result = await joinRoomByCode("JOIN1", sessionUser);

        expect(result).toEqual({ success: true, roomId: room.id });
        expect(classService.addUserToClassroomSession).toHaveBeenCalledWith(room.id, "test@example.com", sessionUser);
        expect(classService.initializeClassroom).not.toHaveBeenCalled();
    });

    it("initializes classroom when not in memory", async () => {
        const room = await seedClassroom({ key: "INIT1" });
        const sessionUser = { email: "test@example.com" };

        await joinRoomByCode("INIT1", sessionUser);

        expect(classService.initializeClassroom).toHaveBeenCalledWith(room.id);
    });

    it("throws NotFoundError for invalid code", async () => {
        const sessionUser = { email: "test@example.com" };

        await expect(joinRoomByCode("BADCODE", sessionUser)).rejects.toThrow(NotFoundError);
    });

    it("returns success false when addUserToClassroomSession returns falsy", async () => {
        const room = await seedClassroom({ key: "FAIL1" });
        mockClassrooms[room.id] = { id: room.id };
        classService.addUserToClassroomSession.mockResolvedValueOnce(false);

        const result = await joinRoomByCode("FAIL1", { email: "test@example.com" });

        expect(result).toEqual({ success: false });
    });
});

describe("joinRoom", () => {
    it("wraps joinRoomByCode and emits to user", async () => {
        const room = await seedClassroom({ key: "EMIT1" });
        mockClassrooms[room.id] = { id: room.id };
        const userSession = { email: "user@test.com" };

        const result = await joinRoom(userSession, "EMIT1");

        expect(result).toEqual({ success: true, roomId: room.id });
        expect(emitToUser).toHaveBeenCalledWith("user@test.com", "joinClass", { success: true, roomId: room.id });
    });

    it("propagates NotFoundError from joinRoomByCode", async () => {
        const userSession = { email: "user@test.com" };

        await expect(joinRoom(userSession, "NOPE")).rejects.toThrow(NotFoundError);
    });
});

describe("leaveRoom", () => {
    it("removes user from class and database", async () => {
        const room = await seedClassroom({ owner: 99 });
        await seedClassUser(room.id, 1);
        getIdFromEmail.mockResolvedValueOnce(1);

        await leaveRoom({ classId: room.id, email: "student@test.com" });

        expect(classStateStore.removeClassroomStudent).toHaveBeenCalledWith(room.id, "student@test.com");
        expect(classStateStore.updateUser).toHaveBeenCalledWith("student@test.com", {
            activeClass: null,
            break: false,
            help: false,
            classPermissions: null,
        });

        const row = await mockDatabase.dbGet("SELECT * FROM classusers WHERE classId=? AND studentId=?", [room.id, 1]);
        expect(row).toBeUndefined();
    });

    it("deletes classroom when owner leaves", async () => {
        const room = await seedClassroom({ owner: 1 });
        await seedClassUser(room.id, 1);
        getIdFromEmail.mockResolvedValueOnce(1);

        await leaveRoom({ classId: room.id, email: "owner@test.com" });

        const classroom = await mockDatabase.dbGet("SELECT * FROM classroom WHERE id=?", [room.id]);
        expect(classroom).toBeUndefined();
    });

    it("does not delete classroom when non-owner leaves", async () => {
        const room = await seedClassroom({ owner: 99 });
        await seedClassUser(room.id, 1);
        getIdFromEmail.mockResolvedValueOnce(1);

        await leaveRoom({ classId: room.id, email: "student@test.com" });

        const classroom = await mockDatabase.dbGet("SELECT * FROM classroom WHERE id=?", [room.id]);
        expect(classroom).toBeDefined();
    });

    it("emits leaveSound and reload events", async () => {
        const room = await seedClassroom({ owner: 99 });
        await seedClassUser(room.id, 1);
        getIdFromEmail.mockResolvedValueOnce(1);

        await leaveRoom({ classId: room.id, email: "student@test.com" });

        expect(advancedEmitToClass).toHaveBeenCalledWith("leaveSound", room.id, {});
        expect(emitToUser).toHaveBeenCalledWith("student@test.com", "reload");
    });

    it("calls classUpdate on user sockets if present", async () => {
        const room = await seedClassroom({ owner: 99 });
        await seedClassUser(room.id, 1);
        getIdFromEmail.mockResolvedValueOnce(1);

        const mockSocketUpdate = { classUpdate: jest.fn() };
        userSocketUpdates.set("student@test.com", new Map([["sock1", mockSocketUpdate]]));

        await leaveRoom({ classId: room.id, email: "student@test.com" });

        expect(mockSocketUpdate.classUpdate).toHaveBeenCalledWith(room.id);
        userSocketUpdates.delete("student@test.com");
    });
});
