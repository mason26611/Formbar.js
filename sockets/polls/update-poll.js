const { classStateStore } = require("@services/classroom-service");
const { updatePoll } = require("@services/poll-service");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        /**
         * Updates poll properties dynamically
         * @param {Object} options - Poll properties to update
         *
         * Examples:
         * socket.emit("updatePoll", {status: false}); // Ends poll
         * socket.emit("updatePoll", {excludedRespondents: [1, 2]}); // Changes who can vote
         * socket.emit("updatePoll", {blind: true}); // Makes poll blind
         * socket.emit("updatePoll", {}); // Clears the entire poll
         */
        onSocketEvent(socket, "updatePoll", hasClassScope(SCOPES.CLASS.POLL.CREATE), async (ctx, options) => {
            try {
                const classId = await ctx.resolveClassId();
                if (!classId) {
                    socket.emit("message", "You are not in a class");
                    return;
                }

                if (!options || typeof options !== "object") {
                    socket.emit("message", "Invalid poll update options");
                    return;
                }

                const result = await updatePoll(classId, options, ctx.session);
                if (result) {
                } else {
                    socket.emit("message", "Failed to update poll");
                }
            } catch (err) {
                socket.emit("message", "An error occurred while updating the poll");
            }
        });
    },
};
