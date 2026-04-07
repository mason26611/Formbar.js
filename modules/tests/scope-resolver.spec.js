const {
    resolveUserScopes,
    resolveClassScopes,
    userHasScope,
    classUserHasScope,
    getUserRoleName,
    getClassRoleName,
} = require("@modules/scope-resolver");
const { SCOPES } = require("@modules/permissions");

describe("getUserRoleName", () => {
    it("returns role field when present", () => {
        expect(getUserRoleName({ role: "Teacher" })).toBe("Teacher");
    });

    it("falls back to LEVEL_TO_ROLE for legacy numeric permissions", () => {
        expect(getUserRoleName({ permissions: 2 })).toBe("Student");
    });

    it("prefers role field over permissions", () => {
        expect(getUserRoleName({ role: "Student", permissions: 5 })).toBe("Student");
    });

    it("defaults to Guest for empty object", () => {
        expect(getUserRoleName({})).toBe("Guest");
    });
});

describe("getClassRoleName", () => {
    it("returns classRole field when present", () => {
        expect(getClassRoleName({ classRole: "Mod" })).toBe("Mod");
    });

    it("falls back to classPermissions", () => {
        expect(getClassRoleName({ classPermissions: 4 })).toBe("Teacher");
    });

    it("defaults to Guest for empty object", () => {
        expect(getClassRoleName({})).toBe("Guest");
    });
});

describe("resolveUserScopes", () => {
    it("returns empty array for null user", () => {
        expect(resolveUserScopes(null)).toEqual([]);
    });

    it("Student gets global.pools.manage and global.digipogs.transfer", () => {
        const scopes = resolveUserScopes({ role: "Student" });
        expect(scopes).toContain(SCOPES.GLOBAL.POOLS.MANAGE);
        expect(scopes).toContain(SCOPES.GLOBAL.DIGIPOGS.TRANSFER);
    });

    it("Manager gets all global scopes including global.system.admin", () => {
        const scopes = resolveUserScopes({ role: "Manager" });
        expect(scopes).toContain(SCOPES.GLOBAL.SYSTEM.ADMIN);
        expect(scopes).toContain(SCOPES.GLOBAL.USERS.MANAGE);
        expect(scopes).toContain(SCOPES.GLOBAL.CLASS.CREATE);
        expect(scopes).toContain(SCOPES.GLOBAL.POOLS.MANAGE);
    });

    it("Banned user gets empty array", () => {
        expect(resolveUserScopes({ role: "Banned" })).toEqual([]);
    });

    it("Guest user gets empty array", () => {
        expect(resolveUserScopes({ role: "Guest" })).toEqual([]);
    });
});

describe("resolveClassScopes", () => {
    it("Student classUser gets poll.read, poll.vote, and other student scopes", () => {
        const scopes = resolveClassScopes({ classRole: "Student" }, null);
        expect(scopes).toContain(SCOPES.CLASS.POLL.READ);
        expect(scopes).toContain(SCOPES.CLASS.POLL.VOTE);
        expect(scopes).toContain(SCOPES.CLASS.BREAK.REQUEST);
    });

    it("Manager classUser gets all class scopes", () => {
        const scopes = resolveClassScopes({ classRole: "Manager" }, null);
        expect(scopes).toContain(SCOPES.CLASS.POLL.CREATE);
        expect(scopes).toContain(SCOPES.CLASS.SESSION.START);
        expect(scopes).toContain(SCOPES.CLASS.STUDENTS.READ);
        expect(scopes).toContain(SCOPES.CLASS.DIGIPOGS.AWARD);
    });

    it("respects classroom roleOverrides", () => {
        const classroom = { roleOverrides: { Student: ["custom.scope"] } };
        const scopes = resolveClassScopes({ classRole: "Student" }, classroom);
        expect(scopes).toEqual(["custom.scope"]);
    });

    it("works without classroom (null)", () => {
        const scopes = resolveClassScopes({ classRole: "Guest" }, null);
        expect(scopes).toContain(SCOPES.CLASS.POLL.READ);
    });
});

describe("userHasScope", () => {
    it("Manager has any scope", () => {
        expect(userHasScope({ role: "Manager" }, SCOPES.GLOBAL.SYSTEM.ADMIN)).toBe(true);
        expect(userHasScope({ role: "Manager" }, "anything.at.all")).toBe(true);
    });

    it("Student has global.pools.manage", () => {
        expect(userHasScope({ role: "Student" }, SCOPES.GLOBAL.POOLS.MANAGE)).toBe(true);
    });

    it("Student does not have global.system.admin", () => {
        expect(userHasScope({ role: "Student" }, SCOPES.GLOBAL.SYSTEM.ADMIN)).toBe(false);
    });

    it("null user returns false", () => {
        expect(userHasScope(null, SCOPES.GLOBAL.SYSTEM.ADMIN)).toBe(false);
    });
});

describe("classUserHasScope", () => {
    it("Manager has any class scope", () => {
        expect(classUserHasScope({ classRole: "Manager" }, null, SCOPES.CLASS.POLL.CREATE)).toBe(true);
        expect(classUserHasScope({ classRole: "Manager" }, null, "anything")).toBe(true);
    });

    it("Guest has class.poll.read", () => {
        expect(classUserHasScope({ classRole: "Guest" }, null, SCOPES.CLASS.POLL.READ)).toBe(true);
    });

    it("Guest does not have class.poll.create", () => {
        expect(classUserHasScope({ classRole: "Guest" }, null, SCOPES.CLASS.POLL.CREATE)).toBe(false);
    });
});
