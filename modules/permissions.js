// Permissions range from highest to lowest
const MANAGER_PERMISSIONS = 5;
const TEACHER_PERMISSIONS = 4;
const MOD_PERMISSIONS = 3;
const STUDENT_PERMISSIONS = 2;
const GUEST_PERMISSIONS = 1;
const BANNED_PERMISSIONS = 0;

const SCOPES = {
    GLOBAL: {
        CLASS: {
            CREATE: "global.class.create",
            DELETE: "global.class.delete",
        },
        USERS: {
            MANAGE: "global.users.manage",
        },
        DIGIPOGS: {
            AWARD: "global.digipogs.award",
            TRANSFER: "global.digipogs.transfer",
        },
        POOLS: {
            MANAGE: "global.pools.manage",
        },
        SYSTEM: {
            ADMIN: "global.system.admin",
        },
    },

    CLASS: {
        POLL: {
            READ: "class.poll.read",
            VOTE: "class.poll.vote",
            CREATE: "class.poll.create",
            END: "class.poll.end",
            DELETE: "class.poll.delete",
            SHARE: "class.poll.share",
        },

        STUDENTS: {
            READ: "class.students.read",
            KICK: "class.students.kick",
            BAN: "class.students.ban",
            PERM_CHANGE: "class.students.perm_change",
        },

        SESSION: {
            START: "class.session.start",
            END: "class.session.end",
            RENAME: "class.session.rename",
            SETTINGS: "class.session.settings",
            REGENERATE_CODE: "class.session.regenerate_code",
        },

        BREAK: {
            REQUEST: "class.break.request",
            APPROVE: "class.break.approve",
        },

        HELP: {
            REQUEST: "class.help.request",
            APPROVE: "class.help.approve",
        },

        TIMER: {
            CONTROL: "class.timer.control",
        },

        AUXILIARY: {
            CONTROL: "class.auxiliary.control",
        },

        GAMES: {
            ACCESS: "class.games.access",
        },

        TAGS: {
            MANAGE: "class.tags.manage",
        },

        DIGIPOGS: {
            AWARD: "class.digipogs.award",
        },

        LINKS: {
            READ: "class.links.read",
            MANAGE: "class.links.manage",
        },
    },
};

const CLASS_PERMISSIONS = {
    GAMES: "games",
    CONTROL_POLLS: "controlPoll",
    MANAGE_STUDENTS: "manageStudents",
    MANAGE_CLASS: "manageClass",
    BREAK_AND_HELP: "breakHelp",
    AUXILIARY: "auxiliary",
    USER_DEFAULTS: "userDefaults",
};

// Defines the default permissions for people in a class
const DEFAULT_CLASS_PERMISSIONS = {
    links: MOD_PERMISSIONS, // Control the links page
    controlPoll: MOD_PERMISSIONS,
    manageStudents: TEACHER_PERMISSIONS,
    breakHelp: MOD_PERMISSIONS, // Approve break and help requests
    manageClass: TEACHER_PERMISSIONS,
    auxiliary: MOD_PERMISSIONS, // Controls the FormPix lights and sounds
    userDefaults: GUEST_PERMISSIONS,
    seePoll: GUEST_PERMISSIONS, // View polls
    votePoll: STUDENT_PERMISSIONS, // Vote in polls
};

// Maps socket event names to scope strings for the new permission system.
// Global events use global.* scopes; class events use class.* scopes.
const SOCKET_EVENT_SCOPE_MAP = {
    // Global socket events
    deleteClass: SCOPES.GLOBAL.CLASS.DELETE,
    getOwnedClasses: SCOPES.GLOBAL.CLASS.CREATE,
    logout: null, // No scope required
    saveTags: SCOPES.CLASS.TAGS.MANAGE,
    setTags: SCOPES.CLASS.TAGS.MANAGE,
    joinClass: null,
    joinRoom: null,
    getActiveClass: null,
    auth: null, // Backwards-compat: jukebar authentication
    getClassroom: null, // Backwards-compat: classroom state pull
    transferDigipogs: SCOPES.GLOBAL.DIGIPOGS.TRANSFER,
    awardDigipogs: SCOPES.CLASS.DIGIPOGS.AWARD,
    awardDigipogsResponse: SCOPES.CLASS.DIGIPOGS.AWARD,

    // Class socket events
    help: SCOPES.CLASS.HELP.REQUEST,
    pollResp: SCOPES.CLASS.POLL.VOTE,
    requestBreak: SCOPES.CLASS.BREAK.REQUEST,
    endBreak: SCOPES.CLASS.BREAK.REQUEST,
    leaveClass: null,
    leaveRoom: null,
    classUpdate: null,
    setClassSetting: SCOPES.CLASS.SESSION.SETTINGS,
    setClassPermissionSetting: SCOPES.GLOBAL.SYSTEM.ADMIN,
    classPoll: SCOPES.CLASS.POLL.CREATE,
    updatePoll: SCOPES.CLASS.POLL.CREATE,
    timer: SCOPES.CLASS.TIMER.CONTROL,
    timerOn: SCOPES.CLASS.TIMER.CONTROL,
    getPreviousPolls: SCOPES.CLASS.POLL.READ,
    updateExcludedRespondents: SCOPES.CLASS.STUDENTS.READ,

    // Mapped class socket events
    startPoll: SCOPES.CLASS.POLL.CREATE,
    customPollUpdate: SCOPES.CLASS.POLL.CREATE,
    savePoll: SCOPES.CLASS.POLL.CREATE,
    deletePoll: SCOPES.CLASS.POLL.DELETE,
    setPublicPoll: SCOPES.CLASS.POLL.SHARE,
    sharePollToUser: SCOPES.CLASS.POLL.SHARE,
    removeUserPollShare: SCOPES.CLASS.POLL.SHARE,
    getPollShareIds: SCOPES.CLASS.POLL.SHARE,
    sharePollToClass: SCOPES.CLASS.POLL.SHARE,
    removeClassPollShare: SCOPES.CLASS.POLL.SHARE,
    classPermChange: SCOPES.CLASS.STUDENTS.PERM_CHANGE,
    classKickStudent: SCOPES.CLASS.STUDENTS.KICK,
    classKickStudents: SCOPES.CLASS.STUDENTS.KICK,
    classRemoveFromSession: SCOPES.CLASS.STUDENTS.KICK,
    approveBreak: SCOPES.CLASS.BREAK.APPROVE,
    deleteTicket: SCOPES.CLASS.BREAK.APPROVE,
    startClass: SCOPES.CLASS.SESSION.START,
    endClass: SCOPES.CLASS.SESSION.END,
    isClassActive: SCOPES.CLASS.SESSION.SETTINGS,
    regenerateClassCode: SCOPES.CLASS.SESSION.REGENERATE_CODE,
    changeClassName: SCOPES.CLASS.SESSION.RENAME,
    classBannedUsersUpdate: SCOPES.CLASS.STUDENTS.BAN,
    classBanUser: SCOPES.CLASS.STUDENTS.BAN,
    classUnbanUser: SCOPES.CLASS.STUDENTS.BAN,
};

module.exports = {
    SCOPES,
    SOCKET_EVENT_SCOPE_MAP,

    // Permissions (legacy — kept for backward compatibility)
    MANAGER_PERMISSIONS,
    TEACHER_PERMISSIONS,
    MOD_PERMISSIONS,
    STUDENT_PERMISSIONS,
    GUEST_PERMISSIONS,
    BANNED_PERMISSIONS,

    // Page permissions (legacy)
    CLASS_PERMISSIONS,
    DEFAULT_CLASS_PERMISSIONS,
};
