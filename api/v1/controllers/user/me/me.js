const { isAuthenticated } = require("@middleware/authentication");
const { dbGet } = require("@modules/database");
const { classStateStore } = require("@services/classroom-service");
const { resolveUserScopes, resolveClassScopes, getUserRoleName, getClassRoleNames } = require("@modules/scope-resolver");
const { computePermissionLevel } = require("@modules/permissions");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/me:
     *   get:
     *     summary: Get current user information
     *     tags:
     *       - Users
     *     description: |
     *       Returns information about the currently authenticated user, including
     *       their resolved global/class scopes and roles.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     responses:
     *       200:
     *         description: Current user information returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/User'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.get("/user/me", isAuthenticated, async (req, res) => {
        req.infoEvent("user.me.view", "Fetching user information");

        const { digipogs } = await dbGet("SELECT digipogs FROM users WHERE id = ?", [req.user.id]);

        const globalRole = getUserRoleName(req.user);
        const globalScopes = resolveUserScopes(req.user);

        let classRoles = [];
        let classScopes = [];
        const liveUser = classStateStore.getUser(req.user.email);
        if (liveUser && liveUser.activeClass) {
            const classroom = classStateStore.getClassroom(liveUser.activeClass);
            const classStudent = classroom?.students?.[req.user.email];
            if (classStudent) {
                classRoles = getClassRoleNames(classStudent);
                classScopes = resolveClassScopes(classStudent, classroom);
            }
        }

        res.status(200).json({
            success: true,
            data: {
                id: req.user.id,
                email: req.user.email,
                activeClass: req.user.activeClass,
                digipogs: digipogs,
                pogMeter: req.user.pogMeter,
                displayName: req.user.displayName,
                permissions: computePermissionLevel([globalRole]),
                classId: req.user.classId,
                role: globalRole,
                globalScopes,
                classRoles,
                classScopes,
            },
        });
    });
};
