const { SCOPES } = require("@modules/permissions");
const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
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
     *     description: Retrieves all links associated with a classroom. Requires authentication and membership in the classroom.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Class (room) ID
     *     responses:
     *       200:
     *         description: Links retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/LinksResponse'
     *             examples:
     *               success:
     *                 value:
     *                   success: true
     *                   data:
     *                     links:
     *                       - name: "Course Website"
     *                         url: "https://example.com"
     *       400:
     *         description: Bad request - missing or invalid parameters
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Authentication required or invalid credentials
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Insufficient permissions or not a member of the classroom
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Classroom not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *
     * components:
     *   schemas:
     *     Link:
     *       type: object
     *       properties:
     *         name:
     *           type: string
     *           example: "Course Website"
     *         url:
     *           type: string
     *           example: "https://example.com"
     *     LinksData:
     *       type: object
     *       properties:
     *         links:
     *           type: array
     *           items:
     *             $ref: '#/components/schemas/Link'
     *     LinksResponse:
     *       type: object
     *       properties:
     *         success:
     *           type: boolean
     *           example: true
     *         data:
     *           $ref: '#/components/schemas/LinksData'
     */
    router.get("/room/:id/links", isAuthenticated, hasClassScope(SCOPES.CLASS.LINKS.READ), async (req, res) => {
        const classId = req.params.id;
        requireQueryParam(classId, "id");
        req.infoEvent("room.links.view.attempt", "Attempting to view room links", { classId });

        const links = await getLinksInRoom(classId);
        if (links) {
            req.infoEvent("room.links.view.success", "Room links returned", { classId, linkCount: links.length });
            res.status(200).json({
                success: true,
                data: { links },
            });
        }
    });
};
