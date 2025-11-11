const { getClassIDFromCode, getClassUsers, classInformation } = require("../class/classroom");
const { dbRun, dbGet } = require("../database");
const { testData, setupTestDatabase, teardownTestDatabase, injectTestDatabase } = require("./tests");

describe("getClassUsers", () => {
    let testDb;
    let restoreDatabase;

    beforeEach(async () => {
        // Set up test database
        testDb = await setupTestDatabase();
        restoreDatabase = injectTestDatabase(testDb);

        // Create test user in database
        await dbRun(
            "INSERT INTO users (email, username, password, permissions, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ["user123", "user123", "hashed_password", 1, "test_api_key", "test_secret", "Test User", 1],
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

        // Create classusers entry linking user to class
        await dbRun(
            "INSERT INTO classusers (classId, studentId, permissions) VALUES (?, ?, ?)",
            [1, 1, 1],
            testDb
        );
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
        // Clear class cache
        classInformation.classrooms = {};
    });

    it("should get class users", async () => {
        const testUser = {
            email: "user123",
            classPermissions: 2, // Student permissions
        };
        const classUsers = await getClassUsers(testUser, testData.code);
        // Check if result is an error object
        if (classUsers && classUsers.error) {
            throw new Error(`getClassUsers returned error: ${classUsers.error}`);
        }
        expect(classUsers).toHaveProperty("user123");
        expect(classUsers.user123.email).toBe("user123");
        expect(classUsers.user123.id).toBe(1);
        expect(classUsers.user123.permissions).toBe(1);
    });
});

describe("getClassIdFromCode", () => {
    let testDb;
    let restoreDatabase;

    beforeEach(async () => {
        // Set up test database
        testDb = await setupTestDatabase();
        restoreDatabase = injectTestDatabase(testDb);

        // Create test class in database (after migration, classroom table doesn't have permissions column)
        await dbRun(
            "INSERT INTO classroom (name, owner, key, tags) VALUES (?, ?, ?, ?)",
            ["Test Class", 1, testData.code, ""],
            testDb
        );
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

    it("should find class id with valid class code", async () => {
        const classId = await getClassIDFromCode(testData.code);
        expect(classId).toBe(1);
    });

    it("should return null for invalid class code", async () => {
        const classId = await getClassIDFromCode("invalidkey");
        expect(classId).toBe(null);
    });
});
