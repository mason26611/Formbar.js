jest.mock("@services/socket-updates-service", () => ({
    advancedEmitToClass: jest.fn(),
}));
jest.mock("@stores/socket-state-store", () => ({
    socketStateStore: {
        clearRunningTimer: jest.fn(),
        setRunningTimer: jest.fn(),
        getRunningTimer: jest.fn().mockReturnValue(null),
        getRunningTimers: jest.fn().mockReturnValue({}),
        getUserSockets: jest.fn().mockReturnValue({}),
        getRateLimits: jest.fn().mockReturnValue({}),
        getLastActivities: jest.fn().mockReturnValue({}),
    },
}));

const { run: timerRun } = require("../timer");
const { classStateStore } = require("@services/classroom-service");
const { socketStateStore } = require("@stores/socket-state-store");
const { createSocket, createSocketUpdates, createTestClass, testData } = require("@modules/tests/tests");

describe("timer", () => {
    let socket;
    let socketUpdates;
    let vbTimerHandler;
    let timerHandler;
    let timerOnHandler;

    beforeEach(() => {
        jest.useFakeTimers();
        socket = createSocket();
        socketUpdates = createSocketUpdates();

        timerRun(socket, socketUpdates);
        vbTimerHandler = socket.on.mock.calls.find((call) => call[0] === "vbTimer")[1];
        timerHandler = socket.on.mock.calls.find((call) => call[0] === "timer")[1];
        timerOnHandler = socket.on.mock.calls.find((call) => call[0] === "timerOn")[1];
    });

    afterEach(() => {
        jest.useRealTimers();
        classStateStore._state = { users: {}, classrooms: {} };
        jest.clearAllMocks();
    });

    it("should register vbTimer, timer, and timerOn events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("vbTimer");
        expect(events).toContain("timer");
        expect(events).toContain("timerOn");
    });

    describe("timer event", () => {
        it("should update the classroom timer data", () => {
            const classData = createTestClass(testData.code, "Test Class");
            timerHandler(60, true, false);

            expect(classData.timer.startTime).toBe(60);
            expect(classData.timer.timeLeft).toBe(60);
            expect(classData.timer.active).toBe(true);
            expect(classData.timer.sound).toBe(false);
        });

        it("should round the startTime value", () => {
            const classData = createTestClass(testData.code, "Test Class");
            timerHandler(59.7, true, false);
            expect(classData.timer.startTime).toBe(60);
        });

        it("should call socketUpdates.classUpdate after updating the timer", () => {
            createTestClass(testData.code, "Test Class");
            timerHandler(30, false, true);
            expect(socketUpdates.classUpdate).toHaveBeenCalled();
        });

        it("should call socketUpdates.timer immediately when active is true", () => {
            createTestClass(testData.code, "Test Class");
            timerHandler(30, true, false);
            expect(socketUpdates.timer).toHaveBeenCalledWith(false, true);
        });

        it("should start an interval when active is true", () => {
            createTestClass(testData.code, "Test Class");
            timerHandler(30, true, false);
            expect(socketStateStore.setRunningTimer).toHaveBeenCalledWith(testData.classId, expect.any(Object));
        });

        it("should clear any existing timer when active is false", () => {
            createTestClass(testData.code, "Test Class");
            timerHandler(0, false, false);
            expect(socketStateStore.clearRunningTimer).toHaveBeenCalledWith(testData.classId);
        });
    });

    describe("timerOn event", () => {
        it("should emit the current timer active state", () => {
            const classData = createTestClass(testData.code, "Test Class");
            classData.timer.active = true;

            timerOnHandler();
            expect(socket.emit).toHaveBeenCalledWith("timerOn", true);
        });

        it("should emit false when timer is not active", () => {
            const classData = createTestClass(testData.code, "Test Class");
            classData.timer.active = false;

            timerOnHandler();
            expect(socket.emit).toHaveBeenCalledWith("timerOn", false);
        });
    });

    describe("vbTimer event", () => {
        it("should not throw when the class exists", () => {
            const classData = createTestClass(testData.code, "Test Class");
            classData.timer.active = false;
            classData.timer.startTime = 120;

            expect(() => vbTimerHandler()).not.toThrow();
        });
    });
});
