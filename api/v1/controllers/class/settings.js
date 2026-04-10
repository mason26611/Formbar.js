const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { SCOPES } = require("@modules/permissions");
const { updateClassSetting } = require("@services/class-service");

const ValidationError = require("@errors/validation-error");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/settings:
     *   patch:
     *     summary: Update a class setting
     *     tags:
     *       - Class
     *     description: |
     *       Updates a mutable class setting for an active class session.
     *
     *       **Required scope:** `class.session.settings`
     *
     *       Currently supported settings:
     *       - `name`: Renames the class
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
     *                 enum:
     *                   - name
     *                 description: Setting key to update
     *                 example: name
     *               value:
     *                 type: string
     *                 description: New value for the selected setting
     *                 example: Algebra I
     *     responses:
     *       200:
     *         description: Class setting updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Missing class ID, invalid setting, or invalid value
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
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Class not started or not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.patch("/class/:id/settings", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.SETTINGS), async (req, res) => {
        const classId = req.params.id;
        const classSettings = req.body;
        requireQueryParam(classId, "id");

        req.infoEvent("class.settings.update", "Updating class settings", { classId, classSettings });

        await updateClassSetting(classId, classSettings);

        req.infoEvent("class.settings.updated", "Class settings updated", { classId, classSettings });

        res.status(200).json({ success: true });
    });
};
