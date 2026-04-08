const { PASSIVE_SOCKETS } = require("@services/socket-updates-service");
const { getUserRoleName } = require("@modules/scope-resolver");
const { ROLE_NAMES, isRoleAtLeast } = require("@modules/roles");
const { handleSocketError } = require("@modules/socket-error-handler");
const { socketStateStore } = require("@stores/socket-state-store");

module.exports = {
    order: 0,
    run(socket, socketUpdates) {
        // Rate limiter
        socket.use(([event, ...args], next) => {
            try {
                if (!socket.request.session || !socket.request.session.email) {
                    return;
                }

                const email = socket.request.session.email;
                const currentTime = Date.now();
                const timeFrame = 1000; // 1 Second
                const limit = isRoleAtLeast(getUserRoleName(socket.request.session), ROLE_NAMES.TEACHER) ? 100 : 30;
                const userRequests = socketStateStore.getUserRateLimits(email, true);
                userRequests[event] = userRequests[event] || [];
                while (userRequests[event].length && currentTime - userRequests[event][0] > timeFrame) {
                    userRequests[event].shift();
                    userRequests["hasBeenMessaged"] = false;
                }

                if (userRequests[event].length >= limit) {
                    if (!userRequests["hasBeenMessaged"] && !PASSIVE_SOCKETS.includes(event)) {
                        socket.emit("message", `You are being rate limited. Please try again in ${timeFrame / 1000} seconds.`);
                    }
                    userRequests["hasBeenMessaged"] = true;
                } else {
                    userRequests[event].push(currentTime);
                    next();
                }
            } catch (err) {
                handleSocketError(err, socket, "rate-limiter-middleware");
                next(err);
            }
        });
    },
};
