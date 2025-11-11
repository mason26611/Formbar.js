const { run: pollCreationRun } = require("../polls/pollCreation");
const { classInformation } = require("../../modules/class/classroom");
const { logger } = require("../../modules/logger");
const { createTestUser, createTestClass, testData, createSocket, createSocketUpdates } = require("../../modules/tests/tests");
const { userSocketUpdates } = require("../init");
// Note: We're using the real generateColors function instead of mocking it
// This is a pure function with no side effects, so it should be tested directly

describe("startPoll", () => {
    let socket;
    let socketUpdates;
    let startPollHandler;

    beforeEach(() => {
        jest.mock("../../modules/socketUpdates");
        socket = createSocket();
        socketUpdates = createSocketUpdates();
        userSocketUpdates[socket.request.session.email] = socketUpdates;

        const classData = createTestClass(testData.code, "Test Class");
        createTestUser(testData.email, testData.code, 5);
        classData.isActive = true;

        // Simulate user.activeClass
        classData.students[testData.email].activeClass = classData.id;
        classInformation.users[testData.email].activeClass = classData.id;

        // Run the socket handler
        pollCreationRun(socket, socketUpdates);
        startPollHandler = socket.on.mock.calls.find((call) => call[0] === "startPoll")[1];
    });

    it("should start a poll successfully", async () => {
        await startPollHandler({
            prompt: "Test Poll",
            answers: [{}, {}, {}],
            blind: false,
            weight: 1,
            tags: ["tag1"],
            excludedRespondents: ["box1"],
            indeterminate: ["indeterminate1"],
            allowTextResponses: true,
            allowMultipleResponses: true,
        });

        // Check if the poll was started successfully
        expect(socket.emit).toHaveBeenCalledWith("startPoll");
        
        // Verify the poll was actually created with real data
        const poll = classInformation.classrooms[testData.code].poll;
        expect(poll.status).toBe(true);
        expect(poll.prompt).toBe("Test Poll");
        expect(poll.responses).toHaveLength(3);
        // Verify colors were generated (real function output)
        expect(poll.responses[0].color).toMatch(/^#[0-9a-f]{6}$/i); // Valid hex color
        expect(poll.responses[1].color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(poll.responses[2].color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it("should not start a poll if class is not active", async () => {
        classInformation.classrooms[testData.code].isActive = false;

        // Attempt to start the poll then check if it failed
        await startPollHandler({
            prompt: "Test Poll",
            answers: [{}, {}, {}],
            blind: false,
            weight: 1,
            tags: ["tag1"],
            excludedRespondents: ["box1"],
            indeterminate: ["indeterminate1"],
            allowTextResponses: true,
            allowMultipleResponses: true,
        });
        // In current implementation, startPoll is still emitted even if class is inactive
        expect(socket.emit).toHaveBeenCalledWith("startPoll");
        // Poll should remain inactive
        expect(classInformation.classrooms[testData.code].poll.status).toBe(false);
    });

    it("should handle error during poll start gracefully", async () => {
        // Test error handling by using a non-existent user
        // This will cause createPoll to fail when trying to access classInformation.users
        const invalidSocket = createSocket();
        invalidSocket.request.session.email = "nonexistent@example.com";
        
        // Set up handler for invalid socket
        pollCreationRun(invalidSocket, createSocketUpdates());
        const invalidHandler = invalidSocket.on.mock.calls.find((call) => call[0] === "startPoll")[1];
        
        // This should not throw, but should log the error
        await invalidHandler({
            prompt: "Test Poll",
            answers: [{}, {}, {}],
        });
        
        // Error should be logged (logger is mocked in jest.setup.js)
        expect(logger.log).toHaveBeenCalledWith("error", expect.any(String));
    });

    afterAll(() => {
        jest.unmock("../../modules/socketUpdates");
    });
});
