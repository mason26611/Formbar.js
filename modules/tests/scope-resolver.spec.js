const {
    resolveUserScopes,
    resolveClassScopes,
    userHasScope,
    classUserHasScope,
    getUserRoleName,
    getClassRoleName,
    getClassRoleNames,
} = require("@modules/scope-resolver");
const { SCOPES, computeGlobalPermissionLevel } = require("@modules/permissions");

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

    it("Manager scopes do not include blocked and still resolve to permission level 5", () => {
        const scopes = resolveUserScopes({ role: "Manager" });
        expect(scopes).not.toContain(SCOPES.GLOBAL.SYSTEM.BLOCKED);
        expect(computeGlobalPermissionLevel(scopes)).toBe(5);
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

    it("respects classroom roleOverrides (unioned with Guest base)", () => {
        const classroom = { roleOverrides: { Student: ["custom.scope"] } };
        const scopes = resolveClassScopes({ classRole: "Student" }, classroom);
        expect(scopes).toContain("custom.scope");
        expect(scopes).toContain(SCOPES.CLASS.POLL.READ);
        expect(scopes).toContain(SCOPES.CLASS.LINKS.READ);
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

describe("getClassRoleNames", () => {
    it("returns classRoles array when present", () => {
        expect(getClassRoleNames({ classRoles: ["Mod", "Student"] })).toEqual(["Mod", "Student"]);
    });

    it("falls back to single classRole", () => {
        expect(getClassRoleNames({ classRole: "Mod" })).toEqual(["Mod"]);
    });

    it("falls back to numeric classPermissions", () => {
        expect(getClassRoleNames({ classPermissions: 3 })).toEqual(["Mod"]);
    });

    it("returns empty array for no role data", () => {
        expect(getClassRoleNames({})).toEqual([]);
    });
});

describe("multi-role resolveClassScopes", () => {
    it("unions scopes from multiple built-in roles", () => {
        const user = { classRoles: ["Student", "Mod"] };
        const scopes = resolveClassScopes(user, null);
        // Should have Student scopes
        expect(scopes).toContain(SCOPES.CLASS.POLL.VOTE);
        expect(scopes).toContain(SCOPES.CLASS.BREAK.REQUEST);
        // Should have Mod scopes
        expect(scopes).toContain(SCOPES.CLASS.POLL.CREATE);
        expect(scopes).toContain(SCOPES.CLASS.BREAK.APPROVE);
    });

    it("always includes Guest scopes as base", () => {
        const user = { classRoles: ["Mod"] };
        const scopes = resolveClassScopes(user, null);
        expect(scopes).toContain(SCOPES.CLASS.POLL.READ);
        expect(scopes).toContain(SCOPES.CLASS.LINKS.READ);
    });

    it("returns Guest scopes for empty classRoles", () => {
        const user = { classRoles: [] };
        const scopes = resolveClassScopes(user, null);
        expect(scopes).toContain(SCOPES.CLASS.POLL.READ);
        expect(scopes).not.toContain(SCOPES.CLASS.POLL.CREATE);
    });

    it("Banned suppresses all scopes when no Teacher+ role present", () => {
        const user = { classRoles: ["Banned", "Student"] };
        const scopes = resolveClassScopes(user, null);
        expect(scopes).toEqual([]);
    });

    it("Banned does NOT suppress when Teacher role is also present", () => {
        const user = { classRoles: ["Banned", "Teacher"] };
        const scopes = resolveClassScopes(user, null);
        expect(scopes.length).toBeGreaterThan(0);
        expect(scopes).toContain(SCOPES.CLASS.SESSION.START);
    });

    it("Banned does NOT suppress when Manager role is present", () => {
        const user = { classRoles: ["Banned", "Manager"] };
        const scopes = resolveClassScopes(user, null);
        // Manager gets all class scopes
        expect(scopes).toContain(SCOPES.CLASS.POLL.CREATE);
        expect(scopes).toContain(SCOPES.CLASS.SESSION.START);
    });

    it("unions custom role scopes with built-in scopes", () => {
        const classroom = { customRoles: { Helper: [SCOPES.CLASS.HELP.APPROVE] } };
        const user = { classRoles: ["Student", "Helper"] };
        const scopes = resolveClassScopes(user, classroom);
        // Student scopes
        expect(scopes).toContain(SCOPES.CLASS.POLL.VOTE);
        // Custom role scope
        expect(scopes).toContain(SCOPES.CLASS.HELP.APPROVE);
    });

    it("Manager in classRoles gets all class scopes", () => {
        const user = { classRoles: ["Manager"] };
        const scopes = resolveClassScopes(user, null);
        expect(scopes).toContain(SCOPES.CLASS.SESSION.START);
        expect(scopes).toContain(SCOPES.CLASS.POLL.CREATE);
        expect(scopes).toContain(SCOPES.CLASS.STUDENTS.BAN);
    });
});
