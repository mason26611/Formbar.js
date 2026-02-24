const { sendPollResponse } = require("@services/poll-service");
const { classStateStore } = require("@modules/classroom");
const { handleSocketError } = require("@modules/socket-error-handler");

module.exports = {
    run(socket, socketUpdates) {
        socket.on("pollResp", (res, textRes) => {
            try {
                const email = socket.request.session.email;
                const classId = classStateStore.getUser(email).activeClass;
                sendPollResponse(classId, res, textRes, socket.request.session);
            } catch (err) {
                handleSocketError(err, socket, "pollResp");
            }
        });
    },
};
