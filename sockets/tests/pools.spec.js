jest.mock("@services/digipog-service");
jest.mock("@modules/database", () => ({
    dbRun: jest.fn().mockResolvedValue({}),
    dbGet: jest.fn().mockResolvedValue(null),
}));

const { run: poolsRun } = require("../pools");
const pools = require("@services/digipog-service");
const { dbRun, dbGet } = require("@modules/database");
const { createSocket } = require("@modules/tests/tests");

describe("pools", () => {
    let socket;

    beforeEach(() => {
        socket = createSocket();
        poolsRun(socket);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should register all pool socket events", () => {
        const events = socket.on.mock.calls.map((call) => call[0]);
        expect(events).toContain("poolCreate");
        expect(events).toContain("poolDelete");
        expect(events).toContain("poolAddMember");
        expect(events).toContain("poolRemoveMember");
        expect(events).toContain("poolPayout");
    });

    describe("poolCreate event", () => {
        let poolCreateHandler;

        beforeEach(() => {
            poolCreateHandler = socket.on.mock.calls.find((call) => call[0] === "poolCreate")[1];
        });

        it("should reject an invalid pool name", async () => {
            await poolCreateHandler({ name: "", description: "desc" });
            expect(socket.emit).toHaveBeenCalledWith("poolCreateResponse", {
                success: false,
                message: "Invalid pool name.",
            });
        });

        it("should reject a name that is too long", async () => {
            await poolCreateHandler({ name: "a".repeat(51), description: "desc" });
            expect(socket.emit).toHaveBeenCalledWith("poolCreateResponse", {
                success: false,
                message: "Invalid pool name.",
            });
        });

        it("should reject a description that is too long", async () => {
            await poolCreateHandler({ name: "ValidName", description: "x".repeat(256) });
            expect(socket.emit).toHaveBeenCalledWith("poolCreateResponse", {
                success: false,
                message: "Invalid pool description.",
            });
        });

        it("should reject when the user already owns 5 pools", async () => {
            pools.getPoolsForUser.mockResolvedValueOnce([
                { owner: true },
                { owner: true },
                { owner: true },
                { owner: true },
                { owner: true },
            ]);

            await poolCreateHandler({ name: "NewPool", description: "desc" });
            expect(socket.emit).toHaveBeenCalledWith("poolCreateResponse", {
                success: false,
                message: "You can only own up to 5 pools.",
            });
        });

        it("should create a pool successfully", async () => {
            pools.getPoolsForUser.mockResolvedValueOnce([]);
            dbRun.mockResolvedValueOnce(42);
            pools.addUserToPool.mockResolvedValueOnce({});

            await poolCreateHandler({ name: "MyPool", description: "Great pool" });
            expect(socket.emit).toHaveBeenCalledWith("poolCreateResponse", {
                success: true,
                message: "Pool created successfully.",
            });
        });
    });

    describe("poolDelete event", () => {
        let poolDeleteHandler;

        beforeEach(() => {
            poolDeleteHandler = socket.on.mock.calls.find((call) => call[0] === "poolDelete")[1];
        });

        it("should reject an invalid pool id", async () => {
            await poolDeleteHandler({ poolId: -1 });
            expect(socket.emit).toHaveBeenCalledWith("poolDeleteResponse", {
                success: false,
                message: "Invalid pool ID.",
            });
        });

        it("should reject when the user does not own the pool", async () => {
            pools.isUserOwner.mockResolvedValueOnce(false);

            await poolDeleteHandler({ poolId: 1 });
            expect(socket.emit).toHaveBeenCalledWith("poolDeleteResponse", {
                success: false,
                message: "You do not own this pool.",
            });
        });

        it("should delete the pool successfully", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            dbRun.mockResolvedValue({});

            await poolDeleteHandler({ poolId: 1 });
            expect(socket.emit).toHaveBeenCalledWith("poolDeleteResponse", {
                success: true,
                message: "Pool deleted successfully.",
            });
        });
    });

    describe("poolAddMember event", () => {
        let poolAddMemberHandler;

        beforeEach(() => {
            poolAddMemberHandler = socket.on.mock.calls.find((call) => call[0] === "poolAddMember")[1];
        });

        it("should reject an invalid user id", async () => {
            await poolAddMemberHandler({ poolId: 1, userId: -1 });
            expect(socket.emit).toHaveBeenCalledWith("poolAddMemberResponse", {
                success: false,
                message: "Invalid user ID.",
            });
        });

        it("should reject when the user does not own the pool", async () => {
            pools.isUserOwner.mockResolvedValueOnce(false);

            await poolAddMemberHandler({ poolId: 1, userId: 2 });
            expect(socket.emit).toHaveBeenCalledWith("poolAddMemberResponse", {
                success: false,
                message: "You do not own this pool.",
            });
        });

        it("should reject when the target user does not exist", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            dbGet.mockResolvedValueOnce(null);

            await poolAddMemberHandler({ poolId: 1, userId: 2 });
            expect(socket.emit).toHaveBeenCalledWith("poolAddMemberResponse", {
                success: false,
                message: "User not found.",
            });
        });

        it("should reject when the user is already in the pool", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            dbGet.mockResolvedValueOnce({ id: 2, email: "other@test.com" });
            pools.isUserInPool.mockResolvedValueOnce(true);

            await poolAddMemberHandler({ poolId: 1, userId: 2 });
            expect(socket.emit).toHaveBeenCalledWith("poolAddMemberResponse", {
                success: false,
                message: "User is already a member of this pool.",
            });
        });

        it("should add a member successfully", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            dbGet.mockResolvedValueOnce({ id: 2, email: "other@test.com" });
            pools.isUserInPool.mockResolvedValueOnce(false);
            pools.addUserToPool.mockResolvedValueOnce({});

            await poolAddMemberHandler({ poolId: 1, userId: 2 });
            expect(socket.emit).toHaveBeenCalledWith("poolAddMemberResponse", {
                success: true,
                message: "User added to pool successfully.",
            });
        });
    });

    describe("poolRemoveMember event", () => {
        let poolRemoveMemberHandler;

        beforeEach(() => {
            poolRemoveMemberHandler = socket.on.mock.calls.find((call) => call[0] === "poolRemoveMember")[1];
        });

        it("should reject when the user is not in the pool", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            pools.isUserInPool.mockResolvedValueOnce(false);

            await poolRemoveMemberHandler({ poolId: 1, userId: 2 });
            expect(socket.emit).toHaveBeenCalledWith("poolRemoveMemberResponse", {
                success: false,
                message: "User is not a member of this pool.",
            });
        });

        it("should remove a member successfully", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            pools.isUserInPool.mockResolvedValueOnce(true);
            pools.removeUserFromPool.mockResolvedValueOnce({});

            await poolRemoveMemberHandler({ poolId: 1, userId: 2 });
            expect(socket.emit).toHaveBeenCalledWith("poolRemoveMemberResponse", {
                success: true,
                message: "User removed from pool successfully.",
            });
        });
    });

    describe("poolPayout event", () => {
        let poolPayoutHandler;

        beforeEach(() => {
            poolPayoutHandler = socket.on.mock.calls.find((call) => call[0] === "poolPayout")[1];
        });

        it("should reject an invalid pool id", async () => {
            await poolPayoutHandler({ poolId: -1 });
            expect(socket.emit).toHaveBeenCalledWith("poolPayoutResponse", {
                success: false,
                message: "Invalid pool ID.",
            });
        });

        it("should reject when the user does not own the pool", async () => {
            pools.isUserOwner.mockResolvedValueOnce(false);

            await poolPayoutHandler({ poolId: 1 });
            expect(socket.emit).toHaveBeenCalledWith("poolPayoutResponse", {
                success: false,
                message: "You do not own this pool.",
            });
        });

        it("should reject when the pool is not found", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            dbGet.mockResolvedValueOnce(null);

            await poolPayoutHandler({ poolId: 1 });
            expect(socket.emit).toHaveBeenCalledWith("poolPayoutResponse", {
                success: false,
                message: "Pool not found.",
            });
        });

        it("should reject when the pool has no members", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            dbGet.mockResolvedValueOnce({ id: 1, amount: 100 });
            pools.getUsersForPool.mockResolvedValueOnce([]);

            await poolPayoutHandler({ poolId: 1 });
            expect(socket.emit).toHaveBeenCalledWith("poolPayoutResponse", {
                success: false,
                message: "Pool has no members.",
            });
        });

        it("should pay out to members successfully", async () => {
            pools.isUserOwner.mockResolvedValueOnce(true);
            dbGet.mockResolvedValueOnce({ id: 1, amount: 200 });
            pools.getUsersForPool.mockResolvedValueOnce([{ user_id: 2 }, { user_id: 3 }]);
            dbGet.mockResolvedValueOnce({ id: 2, digipogs: 50 });
            dbGet.mockResolvedValueOnce({ id: 3, digipogs: 30 });
            dbRun.mockResolvedValue({});

            await poolPayoutHandler({ poolId: 1 });
            expect(socket.emit).toHaveBeenCalledWith("poolPayoutResponse", {
                success: true,
                message: "Pool payout successful.",
            });
        });
    });
});
