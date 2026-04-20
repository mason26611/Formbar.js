const { setTags, saveTags } = require("@services/class-service");
const { SCOPES } = require("@modules/permissions");
const { onSocketEvent, hasClassScope } = require("@modules/socket-event-middleware");

module.exports = {
    run(socket, socketUpdates) {
        // Update class tag list
        onSocketEvent(socket, "setTags", hasClassScope(SCOPES.CLASS.TAGS.MANAGE), async (ctx, tags) => {
            try {
                await setTags(tags, ctx.session);
                socketUpdates.classUpdate();
            } catch (err) {
                socket.emit("message", "There was a server error try again.");
            }
        });

        // Save tags for a specific student
        onSocketEvent(socket, "saveTags", hasClassScope(SCOPES.CLASS.TAGS.MANAGE), async (ctx, studentId, tags) => {
            try {
                await saveTags(studentId, tags, ctx.session);
                socketUpdates.classUpdate();
            } catch (err) {
                socket.emit("message", "There was a server error try again.");
            }
        });
    },
};
