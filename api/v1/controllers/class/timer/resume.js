const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const { hasClassScope } = require("@middleware/permission-check");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");
const classService = require("@services/class-service");
const { classStateStore } = require("@services/classroom-service");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/timer/resume:
     *   post:
     *     summary: Resumes a class timer
     *     tags:
     *       - Timer
     *     description: |
     *       Resumes a countdown timer for the specified class.
     *
     *       **Required Permission:** `CLASS.TIMER.CONTROL`
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
     *         description: Timer resumed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 data:
     *                   type: object
     *       403:
     *         description: Insufficient permissions or classroom not loaded
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.post("/class/:id/timer/resume", isAuthenticated, hasClassScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        requireQueryParam(classId, "id");

        req.infoEvent("class.timer.resume.attempt", "Attempting to resume a timer", { classId });

        const timer = classService.getTimer(classId);
        if (!timer) {
            throw new ValidationError("No current timer found for this class.");
        }

        classService.resumeTimer(classId);

        req.infoEvent("class.timer.resume.success", "Timer resumed", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
