const { httpPermCheck } = require("@middleware/permission-check");
const { leaveRoom } = require("@services/room-service");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    router.delete("/room/:id", isAuthenticated, httpPermCheck("leaveRoom"), (req, res) => {
        const id = Number(req.params.id);

        requireQueryParam(id, "id");

        req.infoEvent("room.delete.attempt", "User attempting to delete room", { id });


    });
};
