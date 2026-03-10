const { run: updatesRun } = require("../updates");
const { createSocket, createSocketUpdates, testData } = require("@modules/tests/tests");

describe("updates", () => {
    let socket;
    let socketUpdates;
    let classUpdateHandler;
    let customPollUpdateHandler;
    let classBannedUsersUpdateHandler;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();

        updatesRun(socket, socketUpdates);
        classUpdateHandler = socket.on.mock.calls.find((call) => call[0] === "classUpdate")[1];
        customPollUpdateHandler = socket.on.mock.calls.find((call) => call[0] === "customPollUpdate")[1];
        classBannedUsersUpdateHandler = socket.on.mock.calls.find((call) => call[0] === "classBannedUsersUpdate")[1];
    });

    it("should register classUpdate, customPollUpdate, and classBannedUsersUpdate events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("classUpdate");
        expect(events).toContain("customPollUpdate");
        expect(events).toContain("classBannedUsersUpdate");
    });

    it("should call socketUpdates.classUpdate with classId on classUpdate", () => {
        classUpdateHandler();
        expect(socketUpdates.classUpdate).toHaveBeenCalledWith(testData.classId, { global: false });
    });

    it("should call socketUpdates.customPollUpdate with email on customPollUpdate", () => {
        customPollUpdateHandler();
        expect(socketUpdates.customPollUpdate).toHaveBeenCalledWith(testData.email);
    });

    it("should call socketUpdates.classBannedUsersUpdate on classBannedUsersUpdate", () => {
        classBannedUsersUpdateHandler();
        expect(socketUpdates.classBannedUsersUpdate).toHaveBeenCalled();
    });
});
