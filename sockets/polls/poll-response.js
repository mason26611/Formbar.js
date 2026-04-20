const { sendPollResponse } = require("@services/poll-service");
const { classStateStore } = require("@services/classroom-service");
const { handleSocketError } = require("@modules/socket-error-handler");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        onSocketEvent(socket, "pollResp", hasClassScope(SCOPES.CLASS.POLL.VOTE), async (ctx, res, textRes) => {
            try {
                const classId = await ctx.resolveClassId();
                sendPollResponse(classId, res, textRes, ctx.session);
            } catch (err) {
                handleSocketError(err, socket, "pollResp");
            }
        });
    },
};
