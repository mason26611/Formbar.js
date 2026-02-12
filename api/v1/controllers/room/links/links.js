const { GUEST_PERMISSIONS } = require("@modules/permissions");
const { hasClassPermission } = require("@modules/middleware/permission-check");
const { isAuthenticated } = require("@modules/middleware/authentication");
const { isUserInRoom, getLinksInRoom } = require("@services/room-service");
const { requireQueryParam } = require("@modules/error-wrapper");
const ForbiddenError = require("@errors/forbidden-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/room/{id}/links:
     *   get:
     *     summary: Get all links for a room
     *     tags:
     *       - Room - Links
     *     description: Retrieves all links associated with a classroom
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
     *         description: Links retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   name:
     *                     type: string
     *                     example: "Course Website"
     *                   url:
     *                     type: string
     *                     example: "https://example.com"
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.get("/room/:id/links", isAuthenticated, hasClassPermission(GUEST_PERMISSIONS), async (req, res) => {
        const classId = req.params.id;
        requireQueryParam(classId, "id");

        const links = getLinksInRoom(classId);
        if (!(await isUserInRoom(req.user.id, classId))) {
            throw new ForbiddenError("You are not a member of this classroom.");
        }

        if (links) {
            res.status(200).json({
                success: true,
                data: { links },
            });
        }
    });
};
