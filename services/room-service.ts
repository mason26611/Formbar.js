import { ClassroomRow, LinkRow } from "../types/database";
import { UserState, ClassroomState } from "../types/stores";

interface ClassStateStoreInstance {
    getClassroom: (classId: string | number) => ClassroomState | undefined;
    removeClassroomStudent: (classId: string | number, email: string) => void;
    updateUser: (email: string, mutation: Partial<UserState>) => void;
}

const { classStateStore } = require("@services/classroom-service") as {
    classStateStore: ClassStateStoreInstance;
};
const { dbGet, dbRun, dbGetAll } = require("@modules/database") as {
    dbGet: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    dbRun: (sql: string, params?: unknown[]) => Promise<number>;
    dbGetAll: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
};
const { advancedEmitToClass, emitToUser } = require("@services/socket-updates-service") as {
    advancedEmitToClass: (event: string, classId: string | number, options: Record<string, unknown>, ...data: unknown[]) => Promise<void>;
    emitToUser: (email: string, event: string, ...data: unknown[]) => Promise<void>;
};
const { getIdFromEmail } = require("@services/student-service") as {
    getIdFromEmail: (email: string) => number | Promise<number> | undefined;
};
const { userSocketUpdates } = require("../sockets/init") as {
    userSocketUpdates: Map<string, Map<string, { classUpdate: (classId: number) => void }>>;
};
const { requireInternalParam } = require("@modules/error-wrapper") as {
    requireInternalParam: (param: unknown, name: string) => void;
};
const NotFoundError = require("@errors/not-found-error") as new (message: string) => Error;

// Lazy-load class-service to avoid circular dependency
interface ClassService {
    initializeClassroom: (id: number) => Promise<void>;
    addUserToClassroomSession: (classId: number, email: string, sessionUser: SessionUser) => Promise<boolean>;
}

let classService: ClassService | undefined;
function getClassService(): ClassService {
    if (!classService) {
        classService = require("@services/class-service") as ClassService;
    }
    return classService;
}

interface SessionUser {
    email: string;
    classId?: number;
    [key: string]: unknown;
}

interface JoinRoomResult {
    success: boolean;
    roomId?: number;
}

interface RoomOwnerRequest {
    params: { id: string };
    user: { id: number };
    _room?: ClassroomRow;
}

async function deleteRoom(roomId: number): Promise<void> {
    requireInternalParam(roomId, "roomId");

    await dbRun("BEGIN TRANSACTION");
    try {
        await dbRun("DELETE FROM classroom WHERE id=?", [roomId]);
        await dbRun("DELETE FROM classusers WHERE classId=?", [roomId]);
        await dbRun("COMMIT");
    } catch (err) {
        try {
            await dbRun("ROLLBACK");
        } catch (_rollbackErr) {
            // Intentionally ignore rollback errors to avoid masking the original error
        }
        throw err;
    }
}

function getRoomById(roomId: number): Promise<ClassroomRow | undefined> {
    requireInternalParam(roomId, "roomId");

    return dbGet<ClassroomRow>("SELECT * FROM classroom WHERE id=?", [roomId]);
}

/**
 * Join a classroom for the first time using a room code.
 *
 * Use this function when a user is joining with a code they received. For rejoining a class
 * the user is already a member of, use `joinClass` from `class-service` instead.
 *
 * This function will:
 *  - Look up the classroom by the provided code.
 *  - Initialize the classroom in memory if it's not already loaded.
 *  - Delegate the actual joining logic to `class-service.addUserToClassroomSession`.
 *
 * @param code - The room code to join.
 * @param sessionUser - The user's session object (must include `email`).
 * @returns Resolves to an object with `success: true` and `roomId` on success, or `{ success: false }` if the underlying service indicates the join failed.
 * @throws {NotFoundError} If no class exists with that code.
 * @throws {Error} Errors from `class-service` (for example, permission/ban related errors) are propagated.
 */
async function joinRoomByCode(code: string, sessionUser: SessionUser): Promise<JoinRoomResult> {
    const email = sessionUser.email;

    // Find the classroom from the database
    const classroomDb = await dbGet<ClassroomRow>("SELECT * FROM classroom WHERE key=?", [code]);

    // Check to make sure there was a class with that code
    if (!classroomDb) {
        throw new NotFoundError("No class with that code");
    }

    // Initialize classroom if not already loaded
    if (!classStateStore.getClassroom(classroomDb.id)) {
        await getClassService().initializeClassroom(classroomDb.id);
    }

    // Delegate to class-service to handle the actual joining logic
    // This avoids code duplication and keeps room-service focused on code validation
    const result = await getClassService().addUserToClassroomSession(classroomDb.id, email, sessionUser);
    if (!result) {
        return { success: false };
    }

    return {
        success: true,
        roomId: classroomDb.id,
    };
}

/**
 * Join a room by class code and emit the result back to the user's sockets.
 *
 * This wraps `joinRoomByCode` and forwards the resulting payload to the user's
 * connected clients via the `joinClass` socket event.
 *
 * @param userSession - The session object of the user attempting to join. Must include `email` and may include other session data required by `joinRoomByCode`.
 * @param classCode - The code of the class to join.
 * @returns Resolves to the join result returned by `joinRoomByCode`. On success `success` is true and `roomId` is provided.
 * @throws {NotFoundError} If no class exists with that code (propagated from `joinRoomByCode`).
 * @throws {Error} Errors from `class-service` (for example, permission/ban related errors) are propagated.
 */
async function joinRoom(userSession: SessionUser, classCode: string): Promise<JoinRoomResult> {
    const response = await joinRoomByCode(classCode, userSession);
    emitToUser(userSession.email, "joinClass", response);
    return response;
}

/**
 * Removes a user from a classroom.
 * Deletes the user from the class in memory and the database, updates the user's session,
 * emits leave events, and reloads the user's page.
 * @param userData - The session object of the user leaving the room.
 */
async function leaveRoom(userData: SessionUser): Promise<void> {
    const classId = userData.classId;
    const email = userData.email;
    const studentId = await getIdFromEmail(email);

    // Remove the user from the class
    classStateStore.removeClassroomStudent(classId!, email);
    classStateStore.updateUser(email, {
        activeClass: undefined,
        break: false,
        help: false,
        classPermissions: undefined,
    } as Partial<UserState>);
    await dbRun("DELETE FROM classusers WHERE classId=? AND studentId=?", [classId, studentId]);

    // If the owner of the classroom leaves, then delete the classroom
    const ownerRow = await dbGet<Pick<ClassroomRow, "owner">>("SELECT owner FROM classroom WHERE id=?", [classId]);
    if (ownerRow!.owner === studentId) {
        await dbRun("DELETE FROM classroom WHERE id=?", [classId]);
    }

    // Update the class and play leave sound
    const userSockets = userSocketUpdates.get(email);
    if (userSockets) {
        for (const socketUpdate of userSockets.values()) {
            socketUpdate.classUpdate(classId!);
        }
    }

    // Play leave sound and reload the user's page
    await advancedEmitToClass("leaveSound", classId!, {});
    await emitToUser(email, "reload");
}

async function isUserInRoom(userId: number, classId: number): Promise<boolean> {
    const result = await dbGet<Record<string, unknown>>("SELECT 1 FROM classusers WHERE studentId = ? AND classId = ?", [userId, classId]);
    return !!result;
}

function getLinksInRoom(classId: number): Promise<Pick<LinkRow, "name" | "url">[]> {
    requireInternalParam(classId, "classId");
    return dbGetAll<Pick<LinkRow, "name" | "url">>("SELECT name, url FROM links WHERE classId = ?", [classId]);
}

/**
 * Middleware-compatible ownership check for rooms.
 * Returns a promise resolving to boolean, suitable for isOwnerOrHasScope middleware.
 * Also caches the room on req._room for use by the handler.
 */
async function roomOwnerCheck(req: RoomOwnerRequest): Promise<boolean> {
    const room = await getRoomById(Number(req.params.id));
    if (!room) {
        const NotFoundError = require("@errors/not-found-error") as new (message: string) => Error;
        throw new NotFoundError("Room not found");
    }
    req._room = room;
    return room.owner === req.user.id;
}

module.exports = {
    deleteRoom,
    getRoomById,
    roomOwnerCheck,
    joinRoomByCode,
    joinRoom,
    leaveRoom,
    isUserInRoom,
    getLinksInRoom,
};
