const { joinRoomByCode } = require("../joinRoom");
const { dbRun, dbGet } = require("../database");
const { testData, createTestUser, createSocketUpdates, setupTestDatabase, teardownTestDatabase, injectTestDatabase } = require("./tests");
const { userSocketUpdates } = require("../../sockets/init");

describe("joinClass", () => {
    const session = { email: testData.email };
    let testDb;
    let restoreDatabase;

    beforeEach(async () => {
        // Set up test database
        testDb = await setupTestDatabase();
        restoreDatabase = injectTestDatabase(testDb);

        // Create test user in database
        await dbRun(
            "INSERT INTO users (email, username, password, permissions, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [testData.email, testData.email, "hashed_password", 2, "test_api_key", "test_secret", "Test User", 1],
            testDb
        );

        // Create test class in database (after migration, classroom table doesn't have permissions column)
        await dbRun(
            "INSERT INTO classroom (name, owner, key, tags) VALUES (?, ?, ?, ?)",
            ["Test Class", 1, testData.code, ""],
            testDb
        );

        // Create class permissions entry
        await dbRun(
            "INSERT INTO class_permissions (classId, manageClass, manageStudents, controlPoll, votePoll, seePoll, breakHelp, auxiliary, links, userDefaults) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [1, 4, 4, 3, 2, 1, 3, 3, 3, 1],
            testDb
        );

        // Create classusers entry linking user to class (needed for joinRoomByCode)
        await dbRun(
            "INSERT INTO classusers (classId, studentId, permissions) VALUES (?, ?, ?)",
            [1, 1, 2],
            testDb
        );

        // Create test user in memory
        const testUser = createTestUser(testData.email);
        testUser.id = 1; // Set the user ID to match the database
        userSocketUpdates[testData.email] = createSocketUpdates();
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

    it("should join the class successfully", async () => {
        const result = await joinRoomByCode(testData.code, session);
        expect(result).toBe(true);
    });

    it("should return an error for an invalid code", async () => {
        const result = await joinRoomByCode("wrongCode", session);
        expect(result).toBe("No class with that code");
    });
});
