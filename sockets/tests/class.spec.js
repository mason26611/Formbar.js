jest.mock("@services/class-service");
jest.mock("@services/class-membership-service");
jest.mock("@services/student-service");
jest.mock("@services/socket-updates-service");
jest.mock("@modules/util");
jest.mock("@stores/class-code-cache-store", () => ({
    classCodeCacheStore: {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
        invalidateByClassId: jest.fn(),
    },
}));

const { run: classRun } = require("../class");
const { classStateStore } = require("@services/classroom-service");
const { startClass, endClass, leaveClass, isClassActive, joinClass, classKickStudent, classKickStudents } = require("@services/class-service");
const { enrollInClass, unenrollFromClass } = require("@services/class-membership-service");
const { generateKey } = require("@modules/util");
const { createSocket, createSocketUpdates, createTestClass, createTestUser, testData } = require("@modules/tests/tests");

describe("class socket", () => {
    let socket;
    let socketUpdates;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();
        classRun(socket, socketUpdates);
    });

    afterEach(() => {
        classStateStore._state = { users: {}, classrooms: {} };
        jest.clearAllMocks();
    });

    it("should register all expected class socket events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("startClass");
        expect(events).toContain("endClass");
        expect(events).toContain("joinClass");
        expect(events).toContain("joinRoom");
        expect(events).toContain("leaveClass");
        expect(events).toContain("leaveRoom");
        expect(events).toContain("setClassSetting");
        expect(events).toContain("isClassActive");
        expect(events).toContain("regenerateClassCode");
        expect(events).toContain("changeClassName");
    });

    describe("startClass event", () => {
        it("should call startClass with the user's active class id", () => {
            createTestClass(testData.code, "Test Class");
            const userData = createTestUser(testData.email, testData.code, 4);
            userData.activeClass = testData.classId;

            const handler = socket.on.mock.calls.find((call) => call[0] === "startClass")[1];
            handler();

            expect(startClass).toHaveBeenCalledWith(testData.classId);
        });
    });

    describe("endClass event", () => {
        it("should call endClass with the class id and session", () => {
            createTestClass(testData.code, "Test Class");
            const userData = createTestUser(testData.email, testData.code, 4);
            userData.activeClass = testData.classId;

            const handler = socket.on.mock.calls.find((call) => call[0] === "endClass")[1];
            handler();

            expect(endClass).toHaveBeenCalledWith(testData.classId, socket.request.session);
        });
    });

    describe("joinClass event", () => {
        it("should call joinClass with the session and class id", async () => {
            const handler = socket.on.mock.calls.find((call) => call[0] === "joinClass")[1];
            await handler(testData.classId);

            expect(joinClass).toHaveBeenCalledWith(socket.request.session, testData.classId);
        });
    });

    describe("joinRoom event", () => {
        it("should call enrollInClass with the session and class code", () => {
            const handler = socket.on.mock.calls.find((call) => call[0] === "joinRoom")[1];
            handler(testData.code);

            expect(enrollInClass).toHaveBeenCalledWith(socket.request.session, testData.code);
        });
    });

    describe("leaveClass event", () => {
        it("should call leaveClass with the session", () => {
            const handler = socket.on.mock.calls.find((call) => call[0] === "leaveClass")[1];
            handler();

            expect(leaveClass).toHaveBeenCalledWith(socket.request.session);
        });
    });

    describe("leaveRoom event", () => {
        it("should call unenrollFromClass with the session", async () => {
            const handler = socket.on.mock.calls.find((call) => call[0] === "leaveRoom")[1];
            await handler();

            expect(unenrollFromClass).toHaveBeenCalledWith(socket.request.session);
        });
    });

    describe("isClassActive event", () => {
        it("should emit true when the class is active", () => {
            const classData = createTestClass(testData.code, "Test Class");
            classData.isActive = true;
            isClassActive.mockReturnValueOnce(true);

            const handler = socket.on.mock.calls.find((call) => call[0] === "isClassActive")[1];
            handler();

            expect(socket.emit).toHaveBeenCalledWith("isClassActive", true);
        });

        it("should emit false when the class is not active", () => {
            createTestClass(testData.code, "Test Class");
            isClassActive.mockReturnValueOnce(false);

            const handler = socket.on.mock.calls.find((call) => call[0] === "isClassActive")[1];
            handler();

            expect(socket.emit).toHaveBeenCalledWith("isClassActive", false);
        });
    });

    describe("setClassSetting event", () => {
        it("should update a class setting in classStateStore", async () => {
            const classData = createTestClass(testData.code, "Test Class");

            const handler = socket.on.mock.calls.find((call) => call[0] === "setClassSetting")[1];
            await handler("mute", true);

            expect(classData.settings.mute).toBe(true);
            expect(socketUpdates.classUpdate).toHaveBeenCalledWith(testData.classId);
        });
    });
});
