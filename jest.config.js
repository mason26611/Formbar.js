module.exports = {
    preset: "ts-jest",
    setupFiles: ["<rootDir>/jest.setup.ts"],
    moduleNameMapper: {
        "^@modules/(.*)$": "<rootDir>/modules/$1",
        "^@services/(.*)$": "<rootDir>/services/$1",
        "^@controllers/(.*)$": "<rootDir>/api/v1/controllers/$1",
        "^@middleware/(.*)$": "<rootDir>/middleware/$1",
        "^@errors/(.*)$": "<rootDir>/errors/$1",
        "^@sockets/(.*)$": "<rootDir>/sockets/$1",
        "^@stores/(.*)$": "<rootDir>/stores/$1",
        "^@test-helpers/(.*)$": "<rootDir>/modules/test-helpers/$1",
        "^@types/(.*)$": "<rootDir>/types/$1",
    },
    testEnvironment: "node",
    testTimeout: 15000,
    transform: {
        "^.+\\.ts$": "ts-jest",
    },
    testMatch: ["**/*.spec.ts"],
};
