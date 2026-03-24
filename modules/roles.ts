const { SCOPES } = require("@modules/permissions") as {
    SCOPES: {
        GLOBAL: {
            CLASS: { CREATE: string; DELETE: string };
            USERS: { MANAGE: string };
            DIGIPOGS: { AWARD: string; TRANSFER: string };
            POOLS: { MANAGE: string };
            SYSTEM: { ADMIN: string };
        };
        CLASS: {
            POLL: { READ: string; VOTE: string; CREATE: string; END: string; DELETE: string; SHARE: string };
            STUDENTS: { READ: string; KICK: string; BAN: string; PERM_CHANGE: string };
            SESSION: { START: string; END: string; RENAME: string; SETTINGS: string; REGENERATE_CODE: string };
            BREAK: { REQUEST: string; APPROVE: string };
            HELP: { REQUEST: string; APPROVE: string };
            TIMER: { CONTROL: string };
            AUXILIARY: { CONTROL: string };
            GAMES: { ACCESS: string };
            TAGS: { MANAGE: string };
            DIGIPOGS: { AWARD: string };
            LINKS: { READ: string; MANAGE: string };
        };
    };
};

interface RoleScopeSet {
    global: readonly string[];
    class: readonly string[];
}

const ROLE_NAMES = {
    BANNED: "Banned",
    GUEST: "Guest",
    STUDENT: "Student",
    MOD: "Mod",
    TEACHER: "Teacher",
    MANAGER: "Manager",
} as const;

type RoleName = (typeof ROLE_NAMES)[keyof typeof ROLE_NAMES];

const DEFAULT_BANNED_SCOPES: RoleScopeSet = {
    global: [],
    class: [],
};

const DEFAULT_GUEST_SCOPES: RoleScopeSet = {
    global: [],
    class: [SCOPES.CLASS.POLL.READ, SCOPES.CLASS.LINKS.READ],
};

const DEFAULT_STUDENT_SCOPES: RoleScopeSet = {
    global: [SCOPES.GLOBAL.POOLS.MANAGE, SCOPES.GLOBAL.DIGIPOGS.TRANSFER],
    class: [SCOPES.CLASS.POLL.READ, SCOPES.CLASS.POLL.VOTE, SCOPES.CLASS.BREAK.REQUEST, SCOPES.CLASS.HELP.REQUEST, ...DEFAULT_GUEST_SCOPES.class],
};

const DEFAULT_MOD_SCOPES: RoleScopeSet = {
    global: [...DEFAULT_STUDENT_SCOPES.global],
    class: [
        SCOPES.CLASS.POLL.CREATE,
        SCOPES.CLASS.POLL.END,
        SCOPES.CLASS.POLL.DELETE,
        SCOPES.CLASS.POLL.SHARE,

        SCOPES.CLASS.BREAK.APPROVE,
        SCOPES.CLASS.HELP.APPROVE,

        SCOPES.CLASS.AUXILIARY.CONTROL,
        SCOPES.CLASS.GAMES.ACCESS,
        SCOPES.CLASS.TAGS.MANAGE,
        SCOPES.CLASS.LINKS.MANAGE,

        ...DEFAULT_STUDENT_SCOPES.class,
    ],
};

const DEFAULT_TEACHER_SCOPES: RoleScopeSet = {
    global: [SCOPES.GLOBAL.CLASS.CREATE, SCOPES.GLOBAL.CLASS.DELETE, SCOPES.GLOBAL.DIGIPOGS.AWARD, ...DEFAULT_MOD_SCOPES.global],
    class: [
        SCOPES.CLASS.STUDENTS.READ,
        SCOPES.CLASS.STUDENTS.KICK,
        SCOPES.CLASS.STUDENTS.BAN,
        SCOPES.CLASS.STUDENTS.PERM_CHANGE,

        SCOPES.CLASS.SESSION.START,
        SCOPES.CLASS.SESSION.END,
        SCOPES.CLASS.SESSION.RENAME,
        SCOPES.CLASS.SESSION.SETTINGS,
        SCOPES.CLASS.SESSION.REGENERATE_CODE,

        SCOPES.CLASS.TIMER.CONTROL,

        SCOPES.CLASS.DIGIPOGS.AWARD,

        ...DEFAULT_MOD_SCOPES.class,
    ],
};

const DEFAULT_MANAGER_SCOPES: RoleScopeSet = {
    global: [SCOPES.GLOBAL.SYSTEM.ADMIN, SCOPES.GLOBAL.USERS.MANAGE, ...DEFAULT_TEACHER_SCOPES.global],
    class: [...DEFAULT_TEACHER_SCOPES.class],
};

// Maps role names to their default scope sets
const ROLES: Record<RoleName, RoleScopeSet> = {
    [ROLE_NAMES.BANNED]: DEFAULT_BANNED_SCOPES,
    [ROLE_NAMES.GUEST]: DEFAULT_GUEST_SCOPES,
    [ROLE_NAMES.STUDENT]: DEFAULT_STUDENT_SCOPES,
    [ROLE_NAMES.MOD]: DEFAULT_MOD_SCOPES,
    [ROLE_NAMES.TEACHER]: DEFAULT_TEACHER_SCOPES,
    [ROLE_NAMES.MANAGER]: DEFAULT_MANAGER_SCOPES,
};

// Maps legacy numeric permission levels to role names
const LEVEL_TO_ROLE: Record<number, RoleName> = {
    0: ROLE_NAMES.BANNED,
    1: ROLE_NAMES.GUEST,
    2: ROLE_NAMES.STUDENT,
    3: ROLE_NAMES.MOD,
    4: ROLE_NAMES.TEACHER,
    5: ROLE_NAMES.MANAGER,
};

module.exports = {
    ROLE_NAMES,
    ROLES,
    LEVEL_TO_ROLE,
};

export { RoleScopeSet, RoleName };
