const { classStateStore } = require("@services/classroom-service");
const { dbGet, dbRun, dbGetAll } = require("@modules/database");
const { advancedEmitToClass, emitToUser } = require("@services/socket-updates-service");
const { getIdFromEmail } = require("@services/student-service");
const { userSocketUpdates } = require("../sockets/init");
const { requireInternalParam } = require("@modules/error-wrapper");
const NotFoundError = require("@errors/not-found-error");

// Lazy-load class-service to avoid circular dependency
let classService;
function getClassService() {
    if (!classService) {
        classService = require("@services/class-service");
    }
    return classService;
}

async function deleteRoom(roomId) {
    requireInternalParam(roomId, "roomId");

    await dbRun("BEGIN TRANSACTION");
    try {
        await dbRun("DELETE FROM classroom WHERE id=?", [roomId]);
        await dbRun("DELETE FROM classusers WHERE classId=?", [roomId]);
        await dbRun("COMMIT");
    } catch (err) {
        try {
            await dbRun("ROLLBACK");
        } catch (rollbackErr) {
            // Intentionally ignore rollback errors to avoid masking the original error
        }
        throw err;
    }
}

function getRoomById(roomId) {
    requireInternalParam(roomId, "roomId");

    return dbGet("SELECT * FROM classroom WHERE id=?", [roomId]);
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
 * @param {string} code - The room code to join.
 * @param {Object} sessionUser - The user's session object (must include `email`).
 * @returns {Promise<{success: boolean, roomId?: number}>} Resolves to an object with `success: true` and `roomId` on success, or `{ success: false }` if the underlying service indicates the join failed.
 * @throws {NotFoundError} If no class exists with that code.
 * @throws {Error} Errors from `class-service` (for example, permission/ban related errors) are propagated.
 */
async function joinRoomByCode(code, sessionUser) {
    const email = sessionUser.email;

    // Find the classroom from the database
    const classroomDb = await dbGet("SELECT * FROM classroom WHERE key=?", [code]);

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
 * @param {Object} userSession - The session object of the user attempting to join. Must include `email` and may include other session data required by `joinRoomByCode`.
 * @param {string} classCode - The code of the class to join.
 * @returns {Promise<{success: boolean, roomId?: number}>} Resolves to the join result returned by `joinRoomByCode`. On success `success` is true and `roomId` is provided.
 * @throws {NotFoundError} If no class exists with that code (propagated from `joinRoomByCode`).
 * @throws {Error} Errors from `class-service` (for example, permission/ban related errors) are propagated.
 */
async function joinRoom(userSession, classCode) {
    const response = await joinRoomByCode(classCode, userSession);
    emitToUser(userSession.email, "joinClass", response);
    return response;
}

/**
 * Removes a user from a classroom.
 * Deletes the user from the class in memory and the database, updates the user's session,
 * emits leave events, and reloads the user's page.
 * @param {Object} userData - The session object of the user leaving the room.
 * @returns {Promise<void>}
 */
async function leaveRoom(userData) {
    const classId = userData.classId;
    const email = userData.email;
    const studentId = await getIdFromEmail(email);

    // Remove the user from the class
    classStateStore.removeClassroomStudent(classId, email);
    classStateStore.updateUser(email, {
        activeClass: null,
        break: false,
        help: false,
        classPermissions: null,
    });
    await dbRun("DELETE FROM classusers WHERE classId=? AND studentId=?", [classId, studentId]);

    // If the owner of the classroom leaves, then delete the classroom
    const owner = (await dbGet("SELECT owner FROM classroom WHERE id=?", classId)).owner;
    if (owner === studentId) {
        await dbRun("DELETE FROM classroom WHERE id=?", classId);
    }

    // Update the class and play leave sound
    const userSockets = userSocketUpdates.get(email);
    if (userSockets) {
        for (const socketUpdate of userSockets.values()) {
            socketUpdate.classUpdate(classId);
        }
    }

    // Play leave sound and reload the user's page
    await advancedEmitToClass("leaveSound", classId, {});
    await emitToUser(email, "reload");
}

async function isUserInRoom(userId, classId) {
    const result = await dbGet("SELECT 1 FROM classusers WHERE studentId = ? AND classId = ?", [userId, classId]);
    return !!result;
}

function getLinksInRoom(classId) {
    requireInternalParam(classId, "classId");
    return dbGetAll("SELECT name, url FROM links WHERE classId = ?", [classId]);
}

module.exports = {
    deleteRoom,
    getRoomById,
    joinRoomByCode,
    joinRoom,
    leaveRoom,
    isUserInRoom,
    getLinksInRoom,
};
