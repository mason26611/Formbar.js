const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { assignStudentRole } = require("@services/role-service");
const { broadcastClassUpdate } = require("@services/class-service");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/students/{userId}/role:
     *   patch:
     *     summary: Assign a role to a student
     *     tags:
     *       - Class Roles
     *     description: |
     *       Sets the role for a student in the class. The role can be a built-in
     *       role name (e.g. "Mod") or a custom role created for this class.
     *
     *       **Required scope:** `class.students.perm_change`
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: The class ID
     *       - in: path
     *         name: userId
     *         required: true
     *         schema:
     *           type: integer
     *         description: The student's user ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - role
     *             properties:
     *               role:
     *                 type: string
     *                 example: Mod
     *     responses:
     *       200:
     *         description: Role assigned
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *       400:
     *         $ref: '#/components/responses/ValidationError'
     *       401:
     *         $ref: '#/components/responses/UnauthorizedError'
     *       403:
     *         $ref: '#/components/responses/ForbiddenError'
     *       404:
     *         $ref: '#/components/responses/NotFoundError'
     */
    router.patch("/class/:id/students/:userId/role", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.PERM_CHANGE), async (req, res) => {
        const { id: classId, userId } = req.params;
        const { role } = req.body;

        if (!role || typeof role !== "string") {
            throw new ValidationError("role is required and must be a string.");
        }

        await assignStudentRole(classId, userId, role);
        await broadcastClassUpdate(classId);
        res.json({ message: "Role assigned." });
    });
};
