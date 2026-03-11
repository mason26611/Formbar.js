const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const roomService = require("@services/room-service");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.delete("/room/:id", isAuthenticated, async (req, res) => {
        const id = Number(req.params.id);

        requireQueryParam(id, "id");

        req.infoEvent("room.delete.attempt", "User attempting to delete room", { id });

        const room = await roomService.getRoomById(id);
        if (!room) {
            throw new ValidationError("Room not found", { statusCode: 404 });
        }

        await roomService.deleteRoom(room);

        req.infoEvent("room.delete.success", "Room deleted successfully", { id });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
