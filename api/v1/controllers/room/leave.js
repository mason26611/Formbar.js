const { httpPermCheck } = require("@middleware/permission-check");
const { leaveRoom } = require("@services/room-service");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/room/{id}/leave:
     *   post:
     *     summary: Leave a classroom entirely
     *     tags:
     *       - Room
     *     description: |
     *       Leaves the classroom entirely. The user is no longer attached to the classroom.
     *       This is different from leaving a class session - this completely removes the user from the classroom.
     *
     *       **Required Permission:** Class-specific `leaveRoom` permission
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Class ID
     *     responses:
     *       200:
     *         description: Successfully left the classroom
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       400:
     *         description: Unable to leave classroom
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     */
    router.post("/room/:id/leave", isAuthenticated, httpPermCheck("leaveRoom"), async (req, res) => {
        const classId = Number(req.params.id);

        requireQueryParam(classId, "classId");

        req.infoEvent("room.leave.attempt", "User attempting to leave room", { classId });

        await leaveRoom({ ...req.user, classId });

        req.infoEvent("room.leave.success", "User left room successfully", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
