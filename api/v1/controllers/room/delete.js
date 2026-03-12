const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { MANAGER_PERMISSIONS } = require("@modules/permissions");
const roomService = require("@services/room-service");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/room/{id}:
     *   delete:
     *     summary: Delete a room
     *     tags:
     *       - Rooms
     *     description: Deletes a room. The authenticated user must be the room owner or have sufficient permissions.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: Room ID
     *     responses:
     *       200:
     *         description: Room deleted successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       403:
     *         description: Insufficient permissions to delete the room
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Room not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.delete("/room/:id", isAuthenticated, async (req, res) => {
        const id = Number(req.params.id);

        requireQueryParam(id, "id");

        req.infoEvent("room.delete.attempt", "User attempting to delete room", { id });

        const room = await roomService.getRoomById(id);
        if (!room) {
            throw new NotFoundError("Room not found");
        }

        // Check if the user has permissions to delete the room
        if (room.owner !== req.user.id || req.user.permissions >= MANAGER_PERMISSIONS) {
            throw new ForbiddenError("You do not have permission to delete this room.", { statusCode: 403 });
        }

        await roomService.deleteRoom(room.id);

        req.infoEvent("room.delete.success", "Room deleted successfully", { id });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
