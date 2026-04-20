const { requestBreak, approveBreak, endBreak } = require("@services/class-service");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        // Sends a break ticket
        onSocketEvent(socket, "requestBreak", hasClassScope(SCOPES.CLASS.BREAK.REQUEST), async (ctx, reason) => {
            const result = await requestBreak(reason, ctx.session);
            if (result !== true) {
                socket.emit("message", result);
            }
        });

        // Approves the break ticket request
        onSocketEvent(socket, "approveBreak", hasClassScope(SCOPES.CLASS.BREAK.APPROVE), async (ctx, breakApproval, userId) => {
            approveBreak(breakApproval, userId, ctx.session);
        });

        // Ends the break
        onSocketEvent(socket, "endBreak", hasClassScope(SCOPES.CLASS.BREAK.REQUEST), async (ctx) => {
            endBreak(ctx.session);
        });
    },
};
