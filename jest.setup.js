// Prevent the tests from using the logger as it can cause tests to fail
// Logger is a side effect we don't need to test, so we mock it globally
jest.mock("./modules/logger.js", () => ({
    logger: {
        log: jest.fn(),
    },
}));

// Note: Database is no longer mocked globally
// Tests should use in-memory SQLite databases via modules/tests/database.js
// This allows testing actual database operations and SQL queries

// Set lower salt rounds for faster bcrypt tests
// This is safe because we're testing the integration, not the security
if (!process.env.SALT_ROUNDS) {
    process.env.SALT_ROUNDS = "4";
}
