const { sendHelpTicket, deleteHelpTicket } = require("@services/class-service");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        // Sends a help ticket
        onSocketEvent(socket, "help", hasClassScope(SCOPES.CLASS.HELP.REQUEST), async (ctx, reason) => {
            const result = await sendHelpTicket(reason, ctx.session);
            if (result !== true) {
                socket.emit("message", result);
            }
        });

        // Deletes help ticket
        onSocketEvent(socket, "deleteTicket", hasClassScope(SCOPES.CLASS.HELP.APPROVE), async (ctx, studentId) => {
            await deleteHelpTicket(studentId, ctx.session);
        });
    },
};
