const { createSocket, testData, setupTestDatabase, teardownTestDatabase, injectTestDatabase } = require("../../modules/tests/tests");
const { run: apiKeyRun } = require("../refreshInfo");
const { dbRun, dbGet } = require("../../modules/database");

describe("apikey", () => {
    let socket;
    let socketUpdates;
    let refreshApiKeyHandler;
    let testDb;
    let restoreDatabase;

    beforeEach(async () => {
        // Set up test database
        testDb = await setupTestDatabase();
        restoreDatabase = injectTestDatabase(testDb);

        // Create a test user in the database
        await dbRun(
            "INSERT INTO users (email, username, password, permissions, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [testData.email, testData.email, "hashed_password", 2, "old_api_key", "test_secret", "Test User", 1],
            testDb
        );

        socket = createSocket();
        socket.request.session.userId = 1; // Set user ID to match the database

        // Run the socket handler
        apiKeyRun(socket, socketUpdates);
        refreshApiKeyHandler = socket.on.mock.calls.find((call) => call[0] === "refreshApiKey")[1];
    });

    afterEach(async () => {
        // Restore original database
        if (restoreDatabase) {
            restoreDatabase();
        }

        // Close test database
        if (testDb) {
            await teardownTestDatabase(testDb);
        }
    });

    it("should fail if user id is not found in session", async () => {
        socket.request.session.userId = null;
        await refreshApiKeyHandler();
        expect(socket.emit).toHaveBeenCalledWith("error", expect.stringContaining("Error Number"));
    });

    it("should update API key in session and database", async () => {
        const oldApiKey = "old_api_key";
        
        // Verify the old API key is in the database
        const userBefore = await dbGet("SELECT API FROM users WHERE id = ?", [1], testDb);
        expect(userBefore.API).toBe(oldApiKey);

        // Call the handler
        await refreshApiKeyHandler();

        // Verify the API key was updated in the session
        expect(socket.request.session.API).toBeDefined();
        expect(socket.request.session.API).not.toBe(oldApiKey);
        expect(socket.request.session.API).toMatch(/^[0-9a-f]{64}$/); // 32 bytes = 64 hex chars

        // Verify the API key was actually updated in the database
        const userAfter = await dbGet("SELECT API FROM users WHERE id = ?", [1], testDb);
        expect(userAfter.API).toBe(socket.request.session.API);
        expect(userAfter.API).not.toBe(oldApiKey);

        // Verify the socket emitted the update event
        expect(socket.emit).toHaveBeenCalledWith("apiKeyUpdated", socket.request.session.API);
    });
});
