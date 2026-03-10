jest.mock("@services/user-service");
jest.mock("@services/socket-updates-service");

const { run: userRun } = require("../user");
const { logout } = require("@services/user-service");
const { createSocket, createSocketUpdates, testData } = require("@modules/tests/tests");

describe("user", () => {
    let socket;
    let socketUpdates;
    let getOwnedClassesHandler;
    let logoutHandler;

    beforeEach(() => {
        socket = createSocket();
        socketUpdates = createSocketUpdates();

        userRun(socket, socketUpdates);
        getOwnedClassesHandler = socket.on.mock.calls.find((call) => call[0] === "getOwnedClasses")[1];
        logoutHandler = socket.on.mock.calls.find((call) => call[0] === "logout")[1];
    });

    it("should register getOwnedClasses and logout events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("getOwnedClasses");
        expect(events).toContain("logout");
    });

    it("should call socketUpdates.getOwnedClasses with the email", () => {
        getOwnedClassesHandler(testData.email);
        expect(socketUpdates.getOwnedClasses).toHaveBeenCalledWith(testData.email);
    });

    it("should call logout with the socket on logout event", () => {
        logoutHandler();
        expect(logout).toHaveBeenCalledWith(socket);
    });

    it("should not throw when logout service throws an error", () => {
        logout.mockImplementationOnce(() => {
            throw new Error("Logout failed");
        });
        expect(() => logoutHandler()).not.toThrow();
    });
});
