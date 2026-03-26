const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { SCOPES } = require("@modules/permissions");
const { updateClassSetting } = require("@services/class-service");
const { DEFAULT_CLASS_SETTINGS } = require("@services/classroom-service");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/settings:
     *   patch:
     *     summary: Update a class setting
     *     tags:
     *       - Class
     *     description: |
     *       Updates a single class setting. Valid settings are `mute`, `filter`, `sort`, and `isExcluded`.
     *
     *       When `isExcluded` is changed, poll votes from newly excluded students are automatically cleared.
     *
     *       **Required Scope:** `class.session.settings`
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
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - setting
     *               - value
     *             properties:
     *               setting:
     *                 type: string
     *                 enum: [mute, filter, sort, isExcluded]
     *                 description: The setting key to update
     *               value:
     *                 description: The new value for the setting
     *                 oneOf:
     *                   - type: boolean
     *                   - type: string
     *                   - type: object
     *     responses:
     *       200:
     *         description: Setting updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Invalid parameters
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Class not started
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.patch("/class/:id/settings", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.SETTINGS), async (req, res) => {
        const classId = req.params.id;
        const { setting, value } = req.body;

        if (typeof setting !== "string") {
            throw new ValidationError("Setting must be a string.");
        }

        if (value === undefined) {
            throw new ValidationError("Value is required.");
        }

        req.infoEvent("class.settings.update", "Updating class setting", { classId, setting });

        await updateClassSetting(classId, setting, value);

        req.infoEvent("class.settings.updated", "Class setting updated", { classId, setting });

        res.status(200).json({ success: true });
    });
};
