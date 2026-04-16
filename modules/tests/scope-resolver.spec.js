const { userHasScope, getUserScopes, getUserRoleName, getClassRoleName, getClassRoleNames } = require("@modules/scope-resolver");
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

describe("getUserScopes", () => {
    it("filters mixed stored role scopes down to the requested domain", () => {
        const scopes = getUserScopes({
            globalRoles: [
                {
                    id: 1,
                    name: "Student",
                    scopes: ["global.pools.manage", "global.digipogs.transfer", "class.poll.read", "class.poll.vote"],
                },
            ],
            classScopes: ["class.poll.vote", "global.pools.manage"],
        });

        expect(scopes.global).toEqual(["global.pools.manage", "global.digipogs.transfer"]);
        expect(scopes.class).toEqual(["class.poll.vote"]);
    });
});

describe("userHasScope", () => {
    it("Manager has any class scope", () => {
        expect(userHasScope({ classRole: "Manager" }, SCOPES.CLASS.POLL.CREATE, null)).toBe(true);
        expect(userHasScope({ classRole: "Manager" }, SCOPES.CLASS.STUDENTS.KICK, null)).toBe(true);
    });

    it("Guest has class.poll.read", () => {
        expect(userHasScope({ classRole: "Guest" }, SCOPES.CLASS.POLL.READ, null)).toBe(true);
    });

    it("Guest does not have class.poll.create", () => {
        expect(userHasScope({ classRole: "Guest" }, SCOPES.CLASS.POLL.CREATE, null)).toBe(false);
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
