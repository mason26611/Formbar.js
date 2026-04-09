const { dbGet, dbGetAll } = require("@modules/database");
const { getUserOwnedClasses } = require("@services/user-service");
const { getUserJoinedClasses } = require("@services/class-service");
const { isSelfOrHasScope } = require("@middleware/permission-check");
const { SCOPES, computePermissionLevel } = require("@modules/permissions");
const { ROLE_NAMES } = require("@modules/roles");
const { isAuthenticated } = require("@middleware/authentication");
const NotFoundError = require("@errors/not-found-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/classes:
     *   get:
     *     summary: Get all classes associated with a user
     *     tags:
     *       - Users
     *     description: Returns a list of all classes the user is associated with (owned or joined), with each class indicating whether the user is the owner
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: List of classes retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: number
     *                       name:
     *                         type: string
     *                       key:
     *                         type: string
     *                       owner:
     *                         type: number
     *                       isOwner:
     *                         type: boolean
     *                       permissions:
     *                         type: number
     *                       classPermissions:
     *                         type: number
     *       404:
     *         description: User not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get(
        "/user/:id/classes",
        isAuthenticated,
        isSelfOrHasScope(SCOPES.GLOBAL.USERS.MANAGE, "Not authorized to view this user's classes."),
        async (req, res) => {
            const userId = req.params.id;
            req.infoEvent("user.classes.view.attempt", "Attempting to view user classes", { targetUserId: userId });
            const user = await dbGet("SELECT * FROM users WHERE id = ?", [userId]);
            if (!user) {
                throw new NotFoundError("User not found");
            }

            // Get owned classes
            const ownedClasses = await getUserOwnedClasses(user.email, req.user);

            // Get joined classes and filter out banned users
            let joinedClasses = await getUserJoinedClasses(userId);

            // For each joined class, check if user is banned via user_roles
            const bannedClassIds = new Set();
            if (joinedClasses.length) {
                const bannedRows = await dbGetAll(
                    `SELECT ur.classId FROM user_roles ur
                     JOIN roles r ON ur.roleId = r.id
                     WHERE ur.userId = ? AND r.name = ? AND ur.classId IS NOT NULL`,
                    [userId, ROLE_NAMES.BANNED]
                );
                for (const row of bannedRows) {
                    bannedClassIds.add(row.classId);
                }
            }
            joinedClasses = joinedClasses.filter((classroom) => !bannedClassIds.has(classroom.id));

            // Create a map to track classes and combine data
            const classesMap = new Map();

            // Add owned classes first (these are definitely owned)
            for (const ownedClass of ownedClasses) {
                classesMap.set(ownedClass.id, {
                    id: ownedClass.id,
                    name: ownedClass.name,
                    key: ownedClass.key,
                    owner: ownedClass.owner,
                    isOwner: true,
                    permissions: 5,
                    classPermissions: 5,
                    tags: ownedClass.tags,
                });
            }

            // Add joined classes (mark as not owned unless already in map as owned)
            for (const joinedClass of joinedClasses) {
                if (!classesMap.has(joinedClass.id)) {
                    // Get user's class roles to compute permission level
                    const classRoles = await dbGetAll(
                        `SELECT r.name FROM user_roles ur
                         JOIN roles r ON ur.roleId = r.id
                         WHERE ur.userId = ? AND ur.classId = ?`,
                        [userId, joinedClass.id]
                    );
                    const roleNames = classRoles.map((r) => r.name);
                    classesMap.set(joinedClass.id, {
                        id: joinedClass.id,
                        name: joinedClass.name,
                        isOwner: false,
                        permissions: computePermissionLevel(roleNames.length ? roleNames : [ROLE_NAMES.GUEST]),
                        classPermissions: computePermissionLevel(roleNames.length ? roleNames : [ROLE_NAMES.GUEST]),
                    });
                }
            }

            // Convert map to array
            const allClasses = Array.from(classesMap.values());

            req.infoEvent("user.classes.view.success", "User classes returned", { targetUserId: userId, classCount: allClasses.length });
            res.status(200).json({
                success: true,
                data: allClasses,
            });
        }
    );
};
