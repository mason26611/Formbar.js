import type { ClassroomRow, ClassPermissionsRow, ClassUserRow, LinkRow, UserRow } from "../types/database";
import type { UserState, ClassroomState, ClassStudent } from "../types/stores";
import type { Socket } from "socket.io";

// --- Generic DB wrappers ---

const { dbGetAll: _dbGetAll, dbGet: _dbGet, dbRun: _dbRun, database } = require("@modules/database");

const dbGet = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T | undefined> => _dbGet(query, params);
const dbGetAll = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => _dbGetAll(query, params);
const dbRun = (query: string, params?: unknown[]): Promise<number> => _dbRun(query, params);

const _database = database as {
    all: <T>(sql: string, params: unknown[], cb: (err: Error | null, rows: T[]) => void) => void;
    get: <T>(sql: string, params: unknown[], cb: (err: Error | null, row: T | undefined) => void) => void;
};

// --- Typed requires ---

const {
    advancedEmitToClass,
    emitToUser,
    setClassOfApiSockets,
    setClassOfUserSockets,
    userUpdateSocket,
    invalidateClassPollCache,
} = require("@services/socket-updates-service") as {
    advancedEmitToClass: (event: string, classId: number | string, options: Record<string, unknown>, ...data: unknown[]) => Promise<void>;
    emitToUser: (email: string, event: string, ...data: unknown[]) => Promise<void>;
    setClassOfApiSockets: (api: string, classId: number | string | null) => Promise<void>;
    setClassOfUserSockets: (email: string, classId: number | string | null) => Promise<void>;
    userUpdateSocket: (email: string, methodName: string, ...args: unknown[]) => boolean;
    invalidateClassPollCache: (classId: number | string) => void;
};

interface ClassStateStore {
    getClassroom: (classId: number | string) => (ClassroomState & { permissions: ClassPermissions; isActive?: boolean; timer?: TimerState }) | undefined;
    setClassroom: (classId: number | string, classroom: ClassroomState) => void;
    getUser: (email: string) => (UserState & { isGuest?: boolean; tags?: string[]; API?: string; break?: boolean | string; help?: boolean | { reason: string; time: number }; pollRes?: { buttonRes: string | string[]; textRes: string; date: Date | string | null } }) | undefined;
    setUser: (email: string, user: Record<string, unknown>) => void;
    getClassroomStudent: (classId: number | string, email: string) => (ClassStudent & { activeClass?: number | null; classPermissions?: number; isGuest?: boolean; API?: string; break?: boolean | string; help?: boolean | { reason: string; time: number }; pollRes?: { buttonRes: string | string[]; textRes: string; date: Date | string | null }; tags?: string[]; id?: number; pogMeter?: number }) | undefined;
    setClassroomStudent: (classId: number | string, email: string, student: Record<string, unknown>) => void;
    removeClassroomStudent: (classId: number | string, email: string) => void;
    updateClassroom: (classId: number | string, mutation: Partial<ClassroomState> | Record<string, unknown>) => void;
    updateClassroomStudent: (classId: number | string, email: string, mutation: Record<string, unknown>) => void;
    getAllUsers: () => Record<string, UserState>;
}

const { Classroom, classStateStore, getClassIDFromCode } = require("@services/classroom-service") as {
    Classroom: new (params: { id: number; className: string; key: number | string; owner: number; permissions: ClassPermissions; tags: string[] | null; settings?: string | null }) => ClassroomState;
    classStateStore: ClassStateStore;
    getClassIDFromCode: (code: string) => number | Promise<number | null>;
};

const { classCodeCacheStore } = require("@stores/class-code-cache-store") as {
    classCodeCacheStore: { invalidateByClassId: (classId: number) => void };
};

const { socketStateStore } = require("@stores/socket-state-store") as {
    socketStateStore: {
        getUserSocketsByEmail: (email: string) => Record<string, Socket & { request: { session: UserSession & { save: () => void } } }> | undefined;
        hasUserSockets: (email: string) => boolean;
    };
};

const {
    MANAGER_PERMISSIONS,
    DEFAULT_CLASS_PERMISSIONS,
    CLASS_SOCKET_PERMISSIONS,
    BANNED_PERMISSIONS,
    TEACHER_PERMISSIONS,
    MOD_PERMISSIONS,
    STUDENT_PERMISSIONS,
} = require("@modules/permissions") as {
    MANAGER_PERMISSIONS: number;
    DEFAULT_CLASS_PERMISSIONS: Record<string, number>;
    CLASS_SOCKET_PERMISSIONS: Record<string, number>;
    BANNED_PERMISSIONS: number;
    TEACHER_PERMISSIONS: number;
    MOD_PERMISSIONS: number;
    STUDENT_PERMISSIONS: number;
};

const { getStudentsInClass, getIdFromEmail, getEmailFromId } = require("@services/student-service") as {
    getStudentsInClass: (classId: number) => Promise<Record<string, ClassStudent & { tags?: string | string[] | null; displayName?: string | null; email: string }>>;
    getIdFromEmail: (email: string) => number | Promise<number> | undefined;
    getEmailFromId: (userId: number) => Promise<string | null>;
};

const { generateKey } = require("@modules/util") as { generateKey: (size: number) => string };

const { clearPoll } = require("@services/poll-service") as {
    clearPoll: (classId: number | string, userSession: UserSession | undefined, updateClass?: boolean) => Promise<void>;
};

const { requireInternalParam } = require("@modules/error-wrapper") as {
    requireInternalParam: (param: unknown, name: string) => void;
};

const { io } = require("@modules/web-server") as {
    io: {
        to: (room: string) => { emit: (event: string, ...args: unknown[]) => void };
        in: (room: string) => { fetchSockets: () => Promise<Socket[]> };
    };
};

interface AppErrorOptions {
    statusCode?: number;
    event?: string;
    reason?: string;
    [key: string]: unknown;
}

const ValidationError = require("@errors/validation-error") as new (message: string, options?: AppErrorOptions) => Error;
const NotFoundError = require("@errors/not-found-error") as new (message: string, options?: AppErrorOptions) => Error;
const ForbiddenError = require("@errors/forbidden-error") as new (message: string, options?: AppErrorOptions) => Error;
const AppError = require("@errors/app-error") as new (message: string, options?: AppErrorOptions) => Error;

// --- Local interfaces ---

interface TimerState {
    startTime: number;
    endTime: number;
    active: boolean;
    sound: boolean;
    pausedAt?: number;
}

interface ClassPermissions {
    [key: string]: number;
}

interface UserSession {
    email: string;
    classId?: number | string;
    activeClass?: number;
    classPermissions?: number;
    [key: string]: unknown;
}

interface ValidationResult {
    valid: boolean;
    error?: string;
}

interface JoinedClassRow {
    name: string;
    id: number;
    permissions: number;
}

interface DbClassUserRow {
    id: number;
    email: string;
    permissions: number;
    classPermissions: number;
}

interface ClassUserData {
    loggedIn: boolean;
    id: number;
    email: string;
    permissions?: number;
    classPermissions?: number;
    help: boolean | { reason: string; time: number } | null;
    break: boolean | string | null;
    pogMeter: number;
    [key: string]: unknown;
}

interface NormalizedClassroom {
    id: number;
    name: string;
    key: number | string;
    owner: number;
    tags: string[];
    settings?: string | null;
}

// --- Functions ---

function getUserJoinedClasses(userId: number): Promise<JoinedClassRow[]> {
    return dbGetAll<JoinedClassRow>(
        "SELECT classroom.name, classroom.id, classusers.permissions FROM classroom JOIN classusers ON classroom.id = classusers.classId WHERE classusers.studentId = ?",
        [userId]
    );
}

function getClassLinks(classId: number): Promise<Pick<LinkRow, "name" | "url">[]> {
    return dbGetAll<Pick<LinkRow, "name" | "url">>("SELECT name, url FROM links WHERE classId = ?", [classId]);
}

async function getClassCode(classId: number): Promise<number | null> {
    const result = await dbGet<Pick<ClassroomRow, "key">>("SELECT key FROM classroom WHERE id = ?", [classId]);
    return result ? result.key : null;
}

async function getClassIdByCode(classCode: number | string): Promise<number | null> {
    const result = await dbGet<Pick<ClassroomRow, "id">>("SELECT id FROM classroom WHERE key = ?", [classCode]);
    return result ? result.id : null;
}

/**
 * Validates a classroom name
 */
function validateClassroomName(className: string): ValidationResult {
    if (!className || typeof className !== "string") {
        return { valid: false, error: "Classroom name is required" };
    }

    const trimmedName = className.trim();

    // Regex validates: 3-30 chars, no consecutive spaces, allowed chars only
    const validPattern = /^(?!.*\s{2})[a-zA-Z0-9\s\-_.'()&,]{3,30}$/;

    if (!validPattern.test(trimmedName)) {
        if (trimmedName.length === 0) {
            return { valid: false, error: "Classroom name cannot be empty" };
        }
        if (trimmedName.length < 3) {
            return { valid: false, error: "Classroom name must be at least 3 characters long" };
        }
        if (trimmedName.length > 100) {
            return { valid: false, error: "Classroom name must be 100 characters or less" };
        }
        return {
            valid: false,
            error: "Classroom name contains invalid characters. Only letters, numbers, spaces, and common punctuation (- _ . ' ( ) & ,) are allowed",
        };
    }

    return { valid: true };
}

/**
 * Parses and normalizes class permissions from database row
 */
function parseClassPermissions(permissionsRow: ClassPermissionsRow | undefined): ClassPermissions {
    const parsedPermissions: ClassPermissions = {};
    for (const permission of Object.keys(DEFAULT_CLASS_PERMISSIONS)) {
        parsedPermissions[permission] =
            permissionsRow && (permissionsRow as Record<string, unknown>)[permission] != null
                ? (permissionsRow as Record<string, number>)[permission]
                : DEFAULT_CLASS_PERMISSIONS[permission];
    }
    return parsedPermissions;
}

/**
 * Normalizes classroom data fetched from database.
 * Parses JSON fields and normalizes tags and poll history.
 */
function normalizeClassroomData(classroom: { tags: string | string[] | null; [key: string]: unknown }): NormalizedClassroom {
    if (classroom.tags && typeof classroom.tags === "string") {
        classroom.tags = classroom.tags.split(",");
    } else {
        classroom.tags = [];
    }

    return classroom as unknown as NormalizedClassroom;
}

/**
 * Creates a new classroom with the given name and owner
 */
async function createClass(className: string, ownerId: number, ownerEmail: string): Promise<{ classId: number; key: string; className: string }> {
    const validation = validateClassroomName(className);
    if (!validation.valid) {
        throw new ValidationError(validation.error!);
    }

    const key = generateKey(4);

    const insertResult = await dbRun("INSERT INTO classroom(name, owner, key, tags) VALUES(?, ?, ?, ?)", [className, ownerId, key, null]);

    const classId = insertResult;
    if (!classId) {
        throw new AppError("Class was not created successfully");
    }

    const classroom = {
        id: classId,
        name: className,
        key: key,
        tags: null as string | null,
    };

    let permissions = await dbGet<ClassPermissionsRow>("SELECT * FROM class_permissions WHERE classId = ?", [classroom.id]);
    if (!permissions) {
        await dbRun("INSERT OR IGNORE INTO class_permissions (classId) VALUES (?)", [classroom.id]);
    }

    await initializeClassroom(classroom.id);

    return {
        classId: classroom.id,
        key: classroom.key,
        className: classroom.name,
    };
}

/**
 * Initializes a classroom in memory.
 * Fetches all necessary data from the database and creates/updates the classroom in memory.
 */
async function initializeClassroom(id: number): Promise<void> {
    const classroom = await dbGet<ClassroomRow>("SELECT id, name, key, owner, tags FROM classroom WHERE id = ?", [id]);

    if (!classroom) {
        throw new NotFoundError(`Class with id ${id} does not exist`);
    }

    let permissionsRow = await dbGet<ClassPermissionsRow>("SELECT * FROM class_permissions WHERE classId = ?", [id]);
    if (!permissionsRow) {
        await dbRun("INSERT OR IGNORE INTO class_permissions (classId) VALUES (?)", [id]);
        permissionsRow = await dbGet<ClassPermissionsRow>("SELECT * FROM class_permissions WHERE classId = ?", [id]);
    }

    const permissions = parseClassPermissions(permissionsRow);

    const normalized = normalizeClassroomData(classroom as { tags: string | string[] | null; [key: string]: unknown });

    // Validate and normalize permissions
    if (Object.keys(permissions).sort().toString() !== Object.keys(DEFAULT_CLASS_PERMISSIONS).sort().toString()) {
        for (const permission of Object.keys(permissions)) {
            if (!DEFAULT_CLASS_PERMISSIONS[permission]) {
                delete permissions[permission];
            }
        }

        for (const permission of Object.keys(permissions)) {
            if (typeof permissions[permission] != "number" || permissions[permission] < 1 || permissions[permission] > 5) {
                permissions[permission] = DEFAULT_CLASS_PERMISSIONS[permission];
            }
            await dbRun(`UPDATE class_permissions SET ${permission} = ? WHERE classId=?`, [permissions[permission], id]);
        }
    }

    // Create or update classroom in memory
    const existingClassroom = classStateStore.getClassroom(id);
    if (!existingClassroom) {
        classStateStore.setClassroom(
            id,
            new Classroom({
                id,
                className: normalized.name,
                key: normalized.key,
                owner: normalized.owner,
                permissions,
                tags: normalized.tags,
            })
        );
    } else {
        existingClassroom.permissions = permissions;
        existingClassroom.tags = normalized.tags as unknown as string;
    }

    // Get all students in the class and add them to the classroom
    const classStudents = await getStudentsInClass(id);
    for (const studentEmail in classStudents) {
        if (classStateStore.getClassroomStudent(id, studentEmail)) continue;

        const student = classStudents[studentEmail];

        // Normalize student.tags to an array of strings
        if (!Array.isArray(student.tags)) {
            if (typeof student.tags === "string" && student.tags.trim() !== "") {
                student.tags = student.tags
                    .split(",")
                    .map((t: string) => t.trim())
                    .filter(Boolean);
            } else {
                student.tags = [];
            }
        }

        // Ensure 'Offline' is present exactly once at the front
        if (!student.tags.includes("Offline")) {
            student.tags.unshift("Offline");
        }

        student.displayName = student.displayName || student.email;
        classStateStore.setUser(studentEmail, student as unknown as Record<string, unknown>);
        classStateStore.setClassroomStudent(id, studentEmail, student as unknown as Record<string, unknown>);
    }
}

/**
 * Starts a class session by activating the class, emitting the start class event,
 * and updating the class state in memory and to connected clients.
 */
async function startClass(classId: number | string): Promise<void> {
    await advancedEmitToClass("startClassSound", classId, { api: true });

    const classroom = classStateStore.getClassroom(classId);
    if (classroom) {
        classroom.isActive = true;
        advancedEmitToClass(
            "isClassActive",
            classId,
            { classPermissions: CLASS_SOCKET_PERMISSIONS.isClassActive },
            classroom.isActive
        );
    }
}

/**
 * Ends a class session by deactivating the class, emitting the end class event,
 * and updating the class state in memory and to connected clients.
 */
async function endClass(classId: number | string, userSession?: UserSession): Promise<void> {
    await advancedEmitToClass("endClassSound", classId, { api: true });

    const classroom = classStateStore.getClassroom(classId);
    if (classroom) {
        classroom.isActive = false;
    }
    await clearPoll(classId, userSession, true);

    if (classroom) {
        advancedEmitToClass(
            "isClassActive",
            classId,
            { classPermissions: CLASS_SOCKET_PERMISSIONS.isClassActive },
            classroom.isActive
        );
    }
}

/**
 * Checks if the user has the required permission level for a class action.
 */
async function checkUserClassPermission(userId: number | string, classId: number | string, permission: string): Promise<boolean> {
    const email = await getEmailFromId(Number(userId));
    if (!email) throw new NotFoundError("User not found");
    const user = classStateStore.getUser(email);
    const classroom = classStateStore.getClassroom(classId);

    if (!user || !classroom) {
        throw new NotFoundError("User or classroom not found in active sessions");
    }

    return (user.classPermissions ?? 0) >= classroom.permissions[permission];
}

/**
 * Internal function to add a user to a classroom session in memory.
 * Does not perform authorization checks - caller must validate permissions.
 */
async function addUserToClassroomSession(classId: number, email: string, sessionUser: UserSession): Promise<boolean> {
    let user = await dbGet<UserRow>("SELECT id FROM users WHERE email=?", [email]);

    const stateUser = classStateStore.getUser(email);
    if (!user && !stateUser) {
        throw new NotFoundError("User is not in database");
    }

    let resolvedUser: { id: number; isGuest?: boolean; [key: string]: unknown };
    if (stateUser && stateUser.isGuest) {
        resolvedUser = stateUser as unknown as { id: number; isGuest: boolean };
    } else if (user) {
        resolvedUser = user;
    } else {
        throw new NotFoundError("User is not in database");
    }

    // Get the class-user relationship if the user is not a guest
    let classUser: { permissions: number; tags: string; role?: string | null } | undefined;
    if (!resolvedUser.isGuest) {
        classUser = await dbGet<ClassUserRow & { permissions: number; tags: string }>(
            "SELECT * FROM classusers WHERE classId=? AND studentId=?",
            [classId, resolvedUser.id]
        ) as { permissions: number; tags: string; role?: string | null } | undefined;
    }

    const classroomDb = await dbGet<Pick<ClassroomRow, "owner">>("SELECT owner FROM classroom WHERE id=?", [classId]);
    if (!classroomDb) {
        throw new NotFoundError("Class not found");
    }

    // If the user is the owner of the classroom, give them manager permissions
    if (classroomDb.owner === resolvedUser.id) {
        if (!classUser) {
            classUser = { permissions: MANAGER_PERMISSIONS, tags: "" };
        } else {
            classUser.permissions = MANAGER_PERMISSIONS;
        }
    }

    if (classUser) {
        if (classUser.permissions <= BANNED_PERMISSIONS) {
            throw new ForbiddenError("You are banned from that class");
        }

        const currentUser = classStateStore.getUser(email);
        if (!currentUser) {
            throw new NotFoundError("User not found in session");
        }

        currentUser.classPermissions = classUser.permissions;
        currentUser.activeClass = classId;

        const tags = classUser.tags ? classUser.tags.split(",").filter(Boolean) : [];
        currentUser.tags = tags.filter((tag: string) => tag !== "Offline");

        const storeUser = classStateStore.getUser(email);
        if (storeUser) {
            storeUser.tags = currentUser.tags;
        }

        classStateStore.setClassroomStudent(classId, email, currentUser as unknown as Record<string, unknown>);

        const userRef = classStateStore.getUser(email);
        if (userRef) {
            userRef.activeClass = classId;
        }
        advancedEmitToClass("joinSound", classId, {});

        sessionUser.classId = classId;

        setClassOfApiSockets((currentUser as unknown as { API: string }).API, classId);

        // Move all user sockets to the new class room
        setClassOfUserSockets(email, classId);

        userUpdateSocket(email, "classUpdate", classId, { global: false, restrictToControlPanel: true });
        return true;
    } else {
        if (!resolvedUser.isGuest) {
            const classroom = classStateStore.getClassroom(classId);
            await dbRun("INSERT INTO classusers(classId, studentId, permissions) VALUES(?, ?, ?)", [
                classId,
                resolvedUser.id,
                classroom ? classroom.permissions.userDefaults : STUDENT_PERMISSIONS,
            ]);
        }

        const classData = classStateStore.getClassroom(classId);
        const currentUser = classStateStore.getUser(email);
        if (!currentUser || !classData) {
            throw new NotFoundError("User or class not found in session");
        }

        currentUser.classPermissions = currentUser.id !== classData.owner ? classData.permissions.userDefaults : TEACHER_PERMISSIONS;
        currentUser.activeClass = classId;
        currentUser.tags = [];

        classStateStore.setClassroomStudent(classId, email, currentUser as unknown as Record<string, unknown>);

        const userRef = classStateStore.getUser(email);
        if (userRef) {
            userRef.activeClass = classId;
        }

        setClassOfApiSockets((currentUser as unknown as { API: string }).API, classId);

        // Move all user sockets to the new class room
        setClassOfUserSockets(email, classId);

        userUpdateSocket(email, "classUpdate", classId, { global: false, restrictToControlPanel: true });
        return true;
    }
}

/**
 * Allows a user to join a class by classId or class key.
 */
async function joinClass(userData: UserSession, classId: number | string): Promise<void> {
    const email = userData.email;
    requireInternalParam(classId, "classId");
    requireInternalParam(email, "email");

    const dbClassroom = await dbGet<ClassroomRow>("SELECT * FROM classroom WHERE key=? OR id=?", [classId, classId]);
    if (!dbClassroom) {
        throw new NotFoundError("Class not found");
    }

    const resolvedClassId = dbClassroom.id;

    if (userData.activeClass === resolvedClassId) {
        throw new ValidationError("You are already in that class");
    }

    const studentId = await getIdFromEmail(email);
    const classUsers = await dbGet<ClassUserRow>("SELECT * FROM classusers WHERE studentId=? AND classId=?", [studentId, resolvedClassId]);
    const classroomOwner = await dbGet<Pick<ClassroomRow, "owner">>("SELECT owner FROM classroom WHERE id=?", [resolvedClassId]);

    if (!classUsers && (!classroomOwner || classroomOwner.owner !== studentId)) {
        throw new ForbiddenError("You are not in that class");
    }

    if (!classStateStore.getClassroom(resolvedClassId)) {
        await initializeClassroom(resolvedClassId);
    }

    const response = await addUserToClassroomSession(resolvedClassId, email, userData);

    const userSockets = socketStateStore.getUserSocketsByEmail(email);
    if (response === true && userSockets) {
        for (const userSocket of Object.values(userSockets)) {
            userSocket.request.session.classId = resolvedClassId;
            userSocket.request.session.save();
            userSocket.emit("joinClass", response);
        }
    }
}

/**
 * Removes a user from a class session.
 */
async function leaveClass(userData: UserSession, classId?: number | string): Promise<boolean> {
    if (!classId) {
        classId = userData.activeClass;
    }

    const email = userData.email;
    const user = classStateStore.getUser(email);
    if (!user || user.activeClass !== classId) {
        throw new NotFoundError("User is not in the specified class");
    }

    await advancedEmitToClass("leaveSound", classId!, {});
    const storeUser = classStateStore.getUser(email);
    await classKickStudent(user.id, classId!, { exitRoom: !!(storeUser && storeUser.isGuest) });
    return true;
}

/**
 * Checks if the class with the given classId is currently active.
 */
function isClassActive(classId: number | string): boolean {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) {
        return false;
    }

    return !!classroom.isActive;
}

/**
 * Deletes all classrooms owned by the specified user, along with related data in other tables.
 */
async function deleteRooms(userId: number | string): Promise<void> {
    const classrooms = await dbGetAll<ClassroomRow>("SELECT * FROM classroom WHERE owner=?", [userId]);
    if (classrooms.length == 0) return;

    await dbRun("DELETE FROM classroom WHERE owner=?", [classrooms[0].owner]);
    for (const classroom of classrooms) {
        if (classStateStore.getClassroom(classroom.id)) {
            await endClass(classroom.id);
        }

        await Promise.all([
            dbRun("DELETE FROM classusers WHERE classId=?", [classroom.id]),
            dbRun("DELETE FROM class_polls WHERE classId=?", [classroom.id]),
            dbRun("DELETE FROM links WHERE classId=?", [classroom.id]),
        ]);
        invalidateClassPollCache(classroom.id);
        classCodeCacheStore.invalidateByClassId(classroom.id);
    }
}

// Kick

/**
 * Kicks a student from a class.
 * If exitRoom is true, fully removes them; otherwise just removes from session.
 */
async function classKickStudent(
    userId: number,
    classId: number | string,
    options: { exitRoom?: boolean; ban?: boolean } = { exitRoom: true, ban: false }
): Promise<void> {
    try {
        const email = await getEmailFromId(userId);
        if (!email) return;

        const existingUser = classStateStore.getUser(email);
        if (existingUser) {
            existingUser.activeClass = undefined;
            existingUser.break = false;
            existingUser.help = false;

            if (options.ban) {
                existingUser.classPermissions = BANNED_PERMISSIONS;
            }
            setClassOfApiSockets((existingUser as unknown as { API: string }).API, null);
        }

        const classroom = classStateStore.getClassroom(classId);
        const classroomStudent = classroom ? classroom.students[email] : null;
        if (classroom && classroomStudent) {
            const student = classroomStudent as ClassStudent & { activeClass?: number | null; break?: boolean | string; help?: boolean | { reason: string; time: number }; tags?: string | string[]; isGuest?: boolean; id?: number };
            student.activeClass = null;
            student.break = false;
            student.help = false;
            student.tags = ["Offline"] as unknown as string;
            if (classStateStore.getUser(email)) {
                classStateStore.setUser(email, student as unknown as Record<string, unknown>);
            }

            if (student.isGuest) {
                classStateStore.removeClassroomStudent(classId, email);
            }
        }

        if (options.exitRoom && classroom) {
            const userObj = classStateStore.getUser(email);
            if (userObj && !userObj.isGuest && !options.ban) {
                await dbRun("DELETE FROM classusers WHERE studentId=? AND classId=?", [userObj.id, classId]);
                classStateStore.removeClassroomStudent(classId, email);
            }
        }

        const classOwner = await dbGet<Pick<ClassroomRow, "owner">>("SELECT owner FROM classroom WHERE id=?", [classId]);
        if (classOwner) {
            const ownerEmail = await getEmailFromId(classOwner.owner);
            if (ownerEmail) {
                userUpdateSocket(ownerEmail, "classUpdate", classId);
            }
        }

        const usersSockets = socketStateStore.getUserSocketsByEmail(email);
        if (usersSockets) {
            for (const userSocket of Object.values(usersSockets)) {
                (userSocket as Socket).leave(`class-${classId}`);
                userSocket.request.session.classId = undefined;
                userSocket.request.session.save();
                userSocket.emit("reload");
            }
        }
    } catch (_err) {
        // silently ignore errors
    }
}

/**
 * Kicks all non-teacher students from a class.
 */
function classKickStudents(classId: number | string): void {
    try {
        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) return;
        for (const student of Object.values(classroom.students)) {
            const s = student as ClassStudent & { classPermissions?: number; id?: number };
            if ((s.classPermissions ?? 0) < TEACHER_PERMISSIONS) {
                classKickStudent(s.id ?? 0, classId);
            }
        }
    } catch (_err) {
        // silently ignore errors
    }
}

/**
 * Broadcasts a class update using any connected socket in the class.
 * Prefers a specific user's sockets first when provided.
 */
function broadcastClassUpdate(classId: number | string, preferredEmail?: string): boolean {
    if (!classId) return false;

    if (preferredEmail && userUpdateSocket(preferredEmail, "classUpdate", classId)) {
        return true;
    }

    const classroom = classStateStore.getClassroom(classId);
    if (!classroom || !classroom.students) {
        return false;
    }

    for (const email of Object.keys(classroom.students)) {
        if (email === preferredEmail) continue;
        if (userUpdateSocket(email, "classUpdate", classId)) {
            return true;
        }
    }

    return false;
}

// Break

/**
 * Requests a break for a student.
 */
function requestBreak(reason: string, userData: UserSession): string | true {
    const classId = userData.classId;
    const email = userData.email;
    if (!classId || !classStateStore.getClassroom(classId)?.isActive) {
        return "This class is not currently active.";
    }

    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return "This class is not currently active.";
    const student = classroom.students[email];
    advancedEmitToClass("breakSound", classId, {});
    (student as ClassStudent & { break?: boolean | string }).break = reason;

    broadcastClassUpdate(classId, email);
    return true;
}

/**
 * Approves or denies a break for a student.
 */
async function approveBreak(breakApproval: boolean | string, userId: number, userData: UserSession): Promise<boolean> {
    const email = await getEmailFromId(userId);
    if (!email) throw new NotFoundError("User not found");

    const classId = userData.classId;
    if (!classId) throw new NotFoundError("No active class");
    const student = classStateStore.getClassroomStudent(classId, email);
    classStateStore.updateClassroomStudent(classId, email, { break: breakApproval });

    io.to(`user-${email}`).emit("break", breakApproval);
    if (student && student.API) {
        io.to(`api-${student.API}`).emit("break", breakApproval);
    }
    broadcastClassUpdate(classId, userData.email || email);
    return true;
}

/**
 * Ends a student's active break.
 */
function endBreak(userData: UserSession): void {
    const email = userData.email;
    const classId = userData.classId;
    if (!classId) return;
    const student = classStateStore.getClassroomStudent(classId, email);
    classStateStore.updateClassroomStudent(classId, userData.email, { break: false });

    io.to(`user-${email}`).emit("break", false);
    if (student && student.API) {
        io.to(`api-${student.API}`).emit("break", false);
    }
    broadcastClassUpdate(classId, email);
}

// Help

/**
 * Sends a help ticket for a student.
 */
function sendHelpTicket(reason: string, userSession: UserSession): string | true {
    const classId = userSession.classId;
    const email = userSession.email;
    if (!classId || !classStateStore.getClassroom(classId)?.isActive) {
        return "This class is not currently active.";
    }

    const student = classStateStore.getClassroomStudent(classId, email);
    if (student && typeof student.help === "object" && student.help && student.help.reason === reason) {
        return "You have already requested help for this reason.";
    }

    const time = Date.now();
    classStateStore.updateClassroomStudent(classId, email, { help: { reason: reason, time: time } });

    emitToUser(email, "helpSuccess");
    advancedEmitToClass("helpSound", classId, {});

    broadcastClassUpdate(classId, email);
    return true;
}

/**
 * Deletes a help ticket for a student.
 */
async function deleteHelpTicket(studentId: number, userData: UserSession): Promise<boolean> {
    const classId = userData.classId;
    const email = userData.email;
    const studentEmail = await getEmailFromId(studentId);
    if (!studentEmail || !classId) return false;

    classStateStore.updateClassroomStudent(classId, studentEmail, { help: false });

    broadcastClassUpdate(classId, email);
    return true;
}

// Tags

/**
 * Sets the allowed tags for a class and normalizes existing student tags.
 */
async function setTags(tags: unknown, userSession: UserSession): Promise<void> {
    if (!Array.isArray(tags)) return;

    let normalized: string[] = tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .map((tag) => tag.replace(/[\r\n\t]/g, ""))
        .filter((tag) => tag !== "")
        .sort();
    if (!normalized.includes("Offline")) normalized.push("Offline");

    const classId = userSession.classId;
    const classroom = classId ? classStateStore.getClassroom(classId) : undefined;
    if (!classId || !classroom) return;
    classStateStore.updateClassroom(classId, { tags: normalized as unknown as string });

    for (const student of Object.values(classroom.students)) {
        const s = student as ClassStudent & { classPermissions?: number; tags?: string[]; id?: number };
        if (s.classPermissions == 0 || (s.classPermissions ?? 0) >= 5) continue;
        if (!s.tags) s.tags = [];

        let studentTags: string[] = [];
        studentTags = (s.tags as string[]).filter(Boolean);
        studentTags = studentTags.filter((tag: string) => normalized.includes(tag));
        s.tags = studentTags;

        try {
            await dbRun("UPDATE classusers SET tags = ? WHERE studentId = ? AND classId = ?", [studentTags.join(","), s.id, classId]);
        } catch (_err) {
            // silently ignore
        }
    }

    await dbRun("UPDATE classroom SET tags = ? WHERE id = ?", [normalized.toString(), classId]);
}

/**
 * Saves the tags for a specific student in the class.
 */
async function saveTags(studentId: number, tags: unknown, userSession: UserSession): Promise<void> {
    const email = await getEmailFromId(studentId);
    if (!email) return;
    if (!Array.isArray(tags)) return;

    const userRef = classStateStore.getUser(email);
    const isActiveInClass = userRef && userRef.activeClass === userSession.classId;
    let normalized: string[] = tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .map((tag) => tag.replace(/[\r\n\t]/g, ""))
        .filter((tag) => tag !== "");

    if (isActiveInClass) {
        normalized = normalized.filter((tag) => tag !== "Offline");
    } else if (!normalized.includes("Offline")) {
        normalized.push("Offline");
    }

    normalized = normalized.filter((tag) => tag !== "Offline");

    const classroom = userSession.classId ? classStateStore.getClassroom(userSession.classId) : undefined;
    const student = classroom?.students[email] as (ClassStudent & { tags?: string[]; pollRes?: { buttonRes: string | string[]; textRes: string; date: Date | string | null } }) | undefined;
    if (!student) return;
    const oldTags: string[] = (student.tags as string[]) || [];

    classStateStore.updateClassroomStudent(userSession.classId!, email, { tags: normalized });

    const wasExcluded = oldTags.includes("Excluded");
    const isNowExcluded = normalized.includes("Excluded");

    if (!wasExcluded && isNowExcluded && student.pollRes) {
        student.pollRes.buttonRes = "";
        student.pollRes.textRes = "";
        student.pollRes.date = null;
    }

    await dbRun("UPDATE classusers SET tags = ? WHERE studentId = ? AND classId = ?", [normalized.join(","), studentId, userSession.classId]);
}

// Class Users

/**
 * Gets the users of a class, merging in-memory session data with DB data.
 */
async function getClassUsers(user: { classPermissions?: number; [key: string]: unknown }, key: string): Promise<Record<string, ClassUserData> | { error: string }> {
    const classPermissions = user.classPermissions ?? 0;
    const dbClassUsers = await new Promise<DbClassUserRow[] | { error: string }>((resolve, reject) => {
        _database.all<DbClassUserRow>(
            "SELECT DISTINCT users.id, users.email, users.permissions, CASE WHEN users.id = classroom.owner THEN 5 ELSE COALESCE(classusers.permissions, 1) END AS classPermissions FROM users INNER JOIN classroom ON classroom.key = ? LEFT JOIN classusers ON users.id = classusers.studentId AND classusers.classId = classroom.id WHERE users.id = classroom.owner OR classusers.studentId IS NOT NULL",
            [key],
            (err: Error | null, rows: DbClassUserRow[]) => {
                if (err) return reject(err);
                if (!rows) return resolve({ error: "class does not exist" });
                resolve(rows);
            }
        );
    });

    if ("error" in dbClassUsers) return dbClassUsers as { error: string };

    const classUsers: Record<string, ClassUserData> = {};
    let cDClassUsers: Record<string, ClassStudent> = {};
    const classId = await getClassIDFromCode(key);

    const cdClassroom = classId ? classStateStore.getClassroom(classId) : null;
    if (cdClassroom) {
        cDClassUsers = cdClassroom.students || {};
    }

    for (const userRow of dbClassUsers as DbClassUserRow[]) {
        classUsers[userRow.email] = {
            loggedIn: false,
            ...userRow,
            help: null,
            break: null,
            pogMeter: 0,
        };

        const cdUser = cDClassUsers[userRow.email] as (ClassStudent & { help?: boolean | { reason: string; time: number } | null; break?: boolean | string | null; pogMeter?: number }) | undefined;
        if (cdUser) {
            classUsers[userRow.email].loggedIn = true;
            classUsers[userRow.email].help = cdUser.help ?? null;
            classUsers[userRow.email].break = cdUser.break ?? null;
            classUsers[userRow.email].pogMeter = cdUser.pogMeter ?? 0;
        }

        if (classPermissions <= MOD_PERMISSIONS) {
            if (classUsers[userRow.email].help) {
                classUsers[userRow.email].help = true;
            }
            if (typeof classUsers[userRow.email].break == "string") {
                classUsers[userRow.email].break = false;
            }
        }

        if (classPermissions <= STUDENT_PERMISSIONS) {
            delete classUsers[userRow.email].permissions;
            delete classUsers[userRow.email].classPermissions;
            delete classUsers[userRow.email].help;
            delete classUsers[userRow.email].break;
            delete classUsers[userRow.email].pogMeter;
        }
    }

    return classUsers;
}

// Timer

function getTimer(classId: number | string): TimerState | undefined {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    return classroom.timer;
}

function startTimer({ classId, duration, sound }: { classId: number | string; duration: number; sound?: boolean }): void {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    const startTime = Date.now();
    const endTime = startTime + duration;

    classStateStore.updateClassroom(classId, {
        timer: {
            startTime,
            endTime,
            active: true,
            sound: sound ?? false,
        },
    });

    broadcastClassUpdate(classId);
}

function resumeTimer(classId: number | string): void {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    const timer = classroom.timer;
    if (!timer) return;
    if (timer.active) return;
    const pausedAt = timer.pausedAt;
    if (typeof pausedAt !== "number" || !Number.isFinite(pausedAt)) return;
    if (
        typeof timer.startTime !== "number" ||
        !Number.isFinite(timer.startTime) ||
        typeof timer.endTime !== "number" ||
        !Number.isFinite(timer.endTime)
    )
        return;
    const now = Date.now();
    const pauseDelta = now - pausedAt;

    classStateStore.updateClassroom(classId, {
        timer: {
            ...timer,
            startTime: timer.startTime + pauseDelta,
            endTime: timer.endTime + pauseDelta,
            active: true,
            pausedAt: undefined,
        },
    });

    broadcastClassUpdate(classId);
}

function pauseTimer(classId: number | string): void {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    const timer = classroom.timer;
    if (
        !timer ||
        typeof timer.startTime !== "number" ||
        !Number.isFinite(timer.startTime) ||
        typeof timer.endTime !== "number" ||
        !Number.isFinite(timer.endTime)
    ) {
        return;
    }

    classStateStore.updateClassroom(classId, {
        timer: {
            ...timer,
            active: false,
            pausedAt: Date.now(),
        },
    });

    broadcastClassUpdate(classId);
}

function endTimer(classId: number | string): void {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    classStateStore.updateClassroom(classId, {
        timer: {
            ...(classroom.timer || {}),
            active: false,
        },
    });

    broadcastClassUpdate(classId);
}

function clearTimer(classId: number | string): void {
    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) return;

    classStateStore.updateClassroom(classId, {
        timer: {
            startTime: 0,
            endTime: 0,
            active: false,
            sound: false,
        },
    });

    broadcastClassUpdate(classId);
}

module.exports = {
    getUserJoinedClasses,
    getClassCode,
    getClassLinks,
    getClassIdByCode,
    validateClassroomName,
    initializeClassroom,
    addUserToClassroomSession,
    createClass,
    startClass,
    endClass,
    checkUserClassPermission,
    joinClass,
    leaveClass,
    isClassActive,
    deleteRooms,
    classKickStudent,
    classKickStudents,
    requestBreak,
    approveBreak,
    endBreak,
    sendHelpTicket,
    deleteHelpTicket,
    setTags,
    saveTags,
    getClassUsers,
    getTimer,
    startTimer,
    endTimer,
    clearTimer,
    resumeTimer,
    pauseTimer,
};
