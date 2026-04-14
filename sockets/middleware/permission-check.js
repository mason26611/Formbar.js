const { classStateStore } = require("@services/classroom-service");
const { dbGet } = require("@modules/database");
const { SOCKET_EVENT_SCOPE_MAP } = require("@modules/permissions");
const { PASSIVE_SOCKETS } = require("@services/socket-updates-service");
const { getUserDataFromDb } = require("@services/user-service");
const { camelCaseToNormal } = require("@modules/util");
const { handleSocketError } = require("@modules/socket-error-handler");
const { userHasScope } = require("@modules/scope-resolver");

async function getSocketUserData(socket, email) {
    const cachedUser = classStateStore.getUser(email);
    if (cachedUser) {
        return cachedUser;
    }

    const sessionUserId = socket.request.session?.userId;
    if (sessionUserId != null) {
        return getUserDataFromDb(sessionUserId);
    }

    if (!email) {
        return null;
    }

    const userRow = await dbGet("SELECT id FROM users WHERE email=?", [email]);
    return userRow ? getUserDataFromDb(userRow.id) : null;
}

module.exports = {
    order: 30,
    async run(socket, socketUpdates) {
        // Permission check
        socket.use(async ([event, ...args], next) => {
            try {
                const email = socket.request.session.email;
                const userData = await getSocketUserData(socket, email);

                // If the classId in the session is different from the user's active class, update it
                const classId = userData && userData.activeClass != null ? userData.activeClass : socket.request.session.classId;
                if (!socket.request.session.classId || socket.request.session.classId !== classId) {
                    socket.request.session.classId = classId;
                    socket.request.session.save();
                }

                if (!classStateStore.getClassroom(classId) && classId != null) {
                    socket.emit("message", "Class does not exist");
                    return;
                }

                // If the class provided by the user is not loaded into memory, avoid going further to avoid errors
                if (SOCKET_EVENT_SCOPE_MAP[event] && SOCKET_EVENT_SCOPE_MAP[event]?.startsWith("class.") && !classStateStore.getClassroom(classId)) {
                    socket.emit("message", "Class is not loaded");
                    return;
                }

                // Try scope-based check first
                const requiredScope = SOCKET_EVENT_SCOPE_MAP[event];
                if (requiredScope !== undefined) {
                    // null scope means no permission required
                    if (requiredScope === null) {
                        return next();
                    }

                    // Global scope check
                    if (requiredScope.startsWith("global.") && userHasScope(userData, requiredScope)) {
                        return next();
                    }

                    // Class scope check
                    if (requiredScope.startsWith("class.") && classId) {
                        const classroom = classStateStore.getClassroom(classId);
                        const classUser =
                            classroom?.students[email] ||
                            (userData && classroom && Number(classroom.owner) === Number(userData.id) ? { ...userData, isClassOwner: true } : null);
                        if (classUser && userHasScope(classUser, requiredScope, classroom)) {
                            return next();
                        }
                    }

                    // Scope is mapped but user doesn't have it — deny access
                    if (!PASSIVE_SOCKETS.includes(event)) {
                        socket.emit("message", `You do not have permission to use ${camelCaseToNormal(event)}.`);
                    }
                    return;
                }

                // Unmapped events: allow passive sockets, deny everything else
                if (!PASSIVE_SOCKETS.includes(event)) {
                    socket.emit("message", `You do not have permission to use ${camelCaseToNormal(event)}.`);
                }
            } catch (err) {
                handleSocketError(err, socket, "permission-check-middleware");
                next(err);
            }
        });
    },
};
