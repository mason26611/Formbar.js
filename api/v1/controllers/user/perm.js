const { classStateStore } = require("@services/classroom-service");
const { dbRun } = require("@modules/database");
const { MANAGER_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const ValidationError = require("@errors/validation-error");
const { requireQueryParam, requireBodyParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/perm:
     *   patch:
     *     summary: Change user's global permissions
     *     tags:
     *       - Users
     *     description: Updates a user's global permission level (requires manager permissions)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: number
     *         description: User id
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - perm
     *             properties:
     *               perm:
     *                 type: integer
     *                 example: 3
     *                 description: New permission level
     *     responses:
     *       200:
     *         description: Permissions updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Invalid permission value
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    router.patch("/user/:id/perm", isAuthenticated, hasPermission(MANAGER_PERMISSIONS), async (req, res) => {
        const id = Number(req.params.id);
        let { perm } = req.body || {};

        requireQueryParam(id, "id");
        requireBodyParam(perm, "perm");

        req.infoEvent("user.permissions.update.attempt", "Attempting to update user permissions", { targetUserId: id });

        perm = Number(perm);
        if (!Number.isInteger(perm)) {
            throw new ValidationError("Invalid permission value");
        }

        await dbRun("UPDATE users SET permissions=? WHERE id = ?", [perm, id]);
        if (classStateStore.getUser(id)) {
            classStateStore.updateUser(id, { permissions: perm });
        }

        req.infoEvent("user.permissions.update.success", "User permissions updated", { targetUserId: id, permissionLevel: perm });

        res.status(200).json({
            success: true,
            data: {
                ok: true,
            },
        });
    });
};
