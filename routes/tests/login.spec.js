const request = require("supertest");
const { createExpressServer, createTestUser } = require("../../modules/tests/tests");
const { database } = require("../../modules/database");
const loginRoute = require("../login");
const crypto = require("crypto");

// Mocks
jest.mock("../../modules/crypto", () => ({
    hash: jest.fn().mockResolvedValue("hashed_password"),
    compare: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../modules/database", () => {
    const dbMock = {
        get: jest.fn((query, params, callback = () => {}) => {
            // Handle the complex user query with polls
            if (query.includes("SELECT users.*, CASE WHEN shared_polls.pollId IS NULL")) {
                callback(null, {
                    email: params[0], // email is used as email
                    id: 1,
                    password: "hashed_password",
                    permissions: 2,
                    API: "test_api",
                    sharedPolls: "[]",
                    ownedPolls: "[]",
                    tags: "",
                    displayName: "Test User",
                    verified: 1,
                    email: params[0],
                });
            }
        }),
        run: jest.fn((query, params, callback = () => {}) => {
            // Mock successful user insertion
            if (query.includes("INSERT INTO users")) {
                callback(null);
            } else {
                callback(null);
            }
        }),
        all: jest.fn((query, callback = () => {}) => {
            callback(null, []);
        }),
    };

    return {
        database: dbMock,
        dbRun: jest.fn().mockResolvedValue(),
        dbGet: jest.fn().mockResolvedValue({ token: "mock_token" }),
        dbGetAll: jest.fn().mockResolvedValue([]),
    };
});

jest.mock("../../modules/student", () => ({
    Student: jest.fn().mockImplementation((email, id, permissions, api, ownedPolls, sharedPolls, tags, displayName, guest) => ({
        email,
        id,
        permissions,
        API: api,
        ownedPolls,
        sharedPolls,
        tags,
        displayName,
        guest,
    })),
}));

// Mock settings to disable email verification
jest.mock("../../modules/config", () => ({
    settings: {
        emailEnabled: false,
    },
    logNumbers: {
        error: "MOCK-ERROR-NUMBER",
    },
}));

describe("Login Route", () => {
    let app;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Create a new Express app instance
        app = createExpressServer();

        // Add session mock
        app.use((req, res, next) => {
            req.session = {};
            req.protocol = "http";
            req.get = jest.fn().mockReturnValue("localhost:3000");
            req.ip = "127.0.0.1";
            next();
        });

        // Apply the login route
        loginRoute.run(app);
    });

    describe("GET /login", () => {
        it("should redirect to home if user is already logged in", async () => {
            // Remove session mock to simulate already being logged in
            app = createExpressServer();
            createTestUser("mock_email@mock.com");
            app.use((req, res, next) => {
                req.session = { email: "mock_email@mock.com" };
                next();
            });
            loginRoute.run(app);

            const response = await request(app).get("/login").expect(302);

            expect(response.headers.location).toBe("/");
        });

        it("should render login page if user is not logged in", async () => {
            const response = await request(app).get("/login").expect(200);

            expect(response.body.view).toBe("pages/login");
            expect(response.body.options).toEqual({
                title: "Login",
                redirectURL: undefined,
                route: "login",
            });
        });
    });

    describe("POST /login", () => {
        it("should log in existing user with correct credentials", async () => {
            app = createExpressServer();
            app.use((req, res, next) => {
                req.session = {};
                req.body = {
                    email: "test@example.com",
                    password: "password",
                    loginType: "login",
                };
                next();
            });
            loginRoute.run(app);

            // Mock database.get to return user data
            database.get.mockImplementation((query, params, callback = () => {}) => {
                if (query.includes("SELECT users.*, CASE WHEN shared_polls.pollId IS NULL")) {
                    callback(null, {
                        email: "test@example.com",
                        id: 1,
                        password: "hashed_password",
                        permissions: 2,
                        API: "test_api",
                        sharedPolls: "[]",
                        ownedPolls: "[]",
                        tags: "",
                        displayName: "Test User",
                        verified: 1,
                    });
                } else {
                    callback(null, null);
                }
            });

            const response = await request(app)
                .post("/login")
                .send({
                    email: "test@example.com",
                    password: "password",
                    loginType: "login",
                })
                .expect(302);

            expect(response.headers.location).toBe("/");
            expect(database.get).toHaveBeenCalledWith(
                expect.stringContaining("SELECT users.*, CASE WHEN shared_polls.pollId IS NULL"),
                ["test@example.com"],
                expect.any(Function)
            );
        });

        it("should create a new user account when loginType is new", async () => {
            // Mock dbGetAll to return empty users array (first user will be manager)
            const { dbGetAll } = require("../../modules/database");
            dbGetAll.mockResolvedValue([]);

            // Mock database.get to return the newly created user
            database.get.mockImplementation((query, params, callback = () => {}) => {
                if (query.includes("SELECT users.*, CASE WHEN shared_polls.pollId IS NULL")) {
                    callback(null, null); // No existing user found
                } else if (query.includes("SELECT * FROM users WHERE email")) {
                    // This is called after INSERT, so return the newly created user
                    callback(null, {
                        email: "new@example.com",
                        id: 2,
                        permissions: 5, // manager
                        API: "new_api",
                        secret: "new_secret",
                        tags: "",
                        displayName: "New User",
                        verified: 1,
                    });
                } else {
                    callback(null, null);
                }
            });

            // Mock database.run to call the callback synchronously (this triggers the redirect)
            // The callback will then call database.get, so we need to handle that
            database.run.mockImplementation((query, params, callback = () => {}) => {
                if (query.includes("INSERT INTO users")) {
                    // Call callback synchronously to simulate successful insert
                    // This will trigger the nested database.get call
                    // Use setImmediate to ensure the callback runs after the current execution
                    setImmediate(() => {
                        callback(null);
                    });
                } else {
                    callback(null);
                }
            });

            const response = await request(app)
                .post("/login")
                .send({
                    email: "new@example.com",
                    password: "password123",
                    displayName: "New User",
                    loginType: "new",
                })
                .expect(302);

            expect(database.run).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO users"),
                expect.arrayContaining([
                    "new@example.com",
                    expect.any(String), // hashed password
                    expect.any(Number), // permissions
                    expect.any(String), // API
                    expect.any(String), // secret
                    "New User",
                    1, // verified
                ]),
                expect.any(Function)
            );
        });

        it("should create a guest account when loginType is guest", async () => {
            jest.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.from("abcd"));

            const response = await request(app)
                .post("/login")
                .send({
                    displayName: "Guest User",
                    loginType: "guest",
                })
                .expect(302);

            expect(response.headers.location).toBe("/");
        });

        it("should handle incorrect password", async () => {
            const { compare } = require("../../modules/crypto");
            compare.mockResolvedValueOnce(false);

            database.get.mockImplementation((query, params, callback) => {
                if (query.includes("SELECT users.*, CASE WHEN shared_polls.pollId IS NULL")) {
                    callback(null, {
                        email: "test@example.com",
                        id: 1,
                        password: "hashed_password",
                        permissions: 2,
                        API: "test_api",
                        sharedPolls: "[]",
                        ownedPolls: "[]",
                        tags: "",
                        displayName: "Test User",
                        verified: 1,
                    });
                } else {
                    callback(null, null);
                }
            });

            const response = await request(app)
                .post("/login")
                .send({
                    email: "test@example.com",
                    password: "wrongpassword",
                    loginType: "login",
                })
                .expect(200);

            expect(response.body.view).toBe("pages/login");
            expect(response.body.options.errorMessage).toBe("Incorrect Password. Try again.");
        });

        it("should validate input when creating a new user", async () => {
            const response = await request(app)
                .post("/login")
                .send({
                    email: "new@example.com",
                    password: "pass", // Too short
                    displayName: "New User",
                    loginType: "new",
                })
                .expect(200);

            expect(response.body.view).toBe("pages/login");
            expect(response.body.options).toHaveProperty("title", "Login");
            expect(response.body.options).toHaveProperty("errorMessage", "Invalid password or display name. Please try again.");
        });
    });
});
