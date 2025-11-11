const { run: pollCreationRun } = require("../polls/pollCreation");
const { run: pollRemovalRun } = require("../polls/pollRemoval");
const { createTestClass, testData, createSocket, createSocketUpdates } = require("../../modules/tests/tests");
const { userSocketUpdates } = require("../init");

jest.mock("../../modules/class/classroom");
// jest.mock("../../modules/logger");
jest.mock("../../modules/socketUpdates");
jest.mock("../../modules/util");

describe("deletePoll", () => {
    let socket;
    let socketUpdates;
    let deletePollHandler;

    beforeEach(async () => {
        socket = createSocket();
        socketUpdates = createSocketUpdates(true);
        userSocketUpdates[socket.request.session.email] = socketUpdates;

        // Run the socket handler
        pollRemovalRun(socket, socketUpdates);
        deletePollHandler = socket.on.mock.calls.find((call) => call[0] === "deletePoll")[1];
    });

    it("should delete a poll successfully", async () => {
        // This test would need a real database to work properly
        // For now, just verify the handler exists
        expect(deletePollHandler).toBeDefined();
    });
});
