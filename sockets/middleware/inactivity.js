const { handleSocketError } = require("@modules/socket-error-handler");
const { socketStateStore } = require("@stores/socket-state-store");

const INACTIVITY_LIMIT = 60 * 60 * 1000; // 60 minutes
const lastActivities = socketStateStore.getLastActivities();

module.exports = {
    order: 40,
    run(socket, socketUpdates) {
        // Inactivity timeout middleware
        socket.use(([event, ...args], next) => {
            try {
                // Check if this is an API socket as API sockets should not be tracked for inactivity
                let isApiSocket = false;
                for (const room of socket.rooms) {
                    if (room.startsWith("api-")) {
                        isApiSocket = true;
                        break;
                    }
                }

                // Only track activity for non-API sockets
                if (!isApiSocket) {
                    const email = socket.request.session.email;
                    if (email) {
                        socketStateStore.touchLastActivity(email, socket.id, socket);
                    }
                }

                next();
            } catch (err) {
                handleSocketError(err, socket, "inactivity-middleware");
                next(err);
            }
        });
    },
    INACTIVITY_LIMIT,
    lastActivities,
    socketStateStore,
};
