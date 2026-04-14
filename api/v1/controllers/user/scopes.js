const { isAuthenticated } = require("@middleware/authentication");
const { isSelfOrHasScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { classStateStore } = require("@services/classroom-service");
const { getUserDataFromDb } = require("@services/user-service");
const { getUserScopes, getUserRoleName, getClassRoleNames } = require("@modules/scope-resolver");
const NotFoundError = require("@errors/not-found-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/scopes:
     *   get:
     *     summary: Get resolved scopes and role for a user
     *     tags:
     *       - Users
     *     description: |
     *       Returns the user's resolved role name, global scopes, and (if the user is
     *       in an active class) their class role and class scopes. Only accessible by
     *       the user themselves or a manager.
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user to retrieve scopes for
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: User scopes returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     role:
     *                       type: string
     *                       example: "Student"
     *                     globalScopes:
     *                       type: array
     *                       items:
     *                         type: string
     *                       example: []
     *                     classRoles:
     *                       type: array
     *                       items:
     *                         type: string
     *                       example: ["Student", "Mod"]
     *                     classScopes:
     *                       type: array
     *                       items:
     *                         type: string
     *                       example: ["class.poll.read", "class.poll.vote"]
     *       401:
     *         description: Unauthorized
     *       403:
     *         description: Forbidden - not the user themselves or a manager
     *       404:
     *         description: User not found
     */
    router.get(
        "/user/:id/scopes",
        isAuthenticated,
        isSelfOrHasScope(SCOPES.GLOBAL.USERS.MANAGE, "You do not have permission to view this user's scopes."),
        async (req, res) => {
            const userId = Number(req.params.id);

            const userData = await getUserDataFromDb(userId);
            if (!userData) {
                throw new NotFoundError("User not found.");
            }

            const globalRole = getUserRoleName(userData);
            const scopes = getUserScopes(userData);

            const result = {
                role: globalRole,
                classRoles: [],
                scopes,
            };

            const liveUser = classStateStore.getUser(userData.email);
            if (liveUser && liveUser.activeClass) {
                const classroom = classStateStore.getClassroom(liveUser.activeClass);
                const classStudent = classroom?.students?.[userData.email];
                if (classStudent) {
                    result.classRoles = classStudent.classRoleRefs || [];
                }
            }

            res.status(200).json({
                success: true,
                data: result,
            });
        }
    );
};
