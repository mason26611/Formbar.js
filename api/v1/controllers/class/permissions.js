const { classStateStore } = require("@services/classroom-service");
const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const { updateClassPermission } = require("@services/class-service");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/class/{id}/permissions:
     *   get:
     *     summary: Get class permissions
     *     tags:
     *       - Class
     *     description: |
     *       Returns the permissions configuration for a class.
     *
     *       **Required Permission:** Must be a member of the class (any permission level)
     *
     *       **Permission Levels:**
     *       - 1: Guest
     *       - 2: Student
     *       - 3: Moderator
     *       - 4: Teacher
     *       - 5: Manager
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
     *         description: Permissions retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ClassPermission'
     *       401:
     *         description: Not authenticated
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       403:
     *         description: User is not logged into the selected class
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
    router.get("/class/:id/permissions", isAuthenticated, async (req, res) => {
        // Get the class key from the request parameters and log the request details
        const classId = Number(req.params.id);

        requireQueryParam(classId, "id");
        if (!Number.isInteger(classId) || classId <= 0) {
            throw new ValidationError("Invalid class id");
        }

        req.infoEvent("class.permissions.view", "Viewing class permissions", { classId });

        // Get a clone of the class data
        // If the class does not exist, return an error
        let classData = structuredClone(classStateStore.getClassroom(classId));
        if (!classData) {
            throw new NotFoundError("Class not started");
        }

        // Get the user from the session
        // If the user is not in the class, return an error
        if (!classData.students[req.user?.email] && classData.owner !== req.user?.id) {
            throw new ForbiddenError("User is not logged into the selected class", {
                event: "class.permissions.not_in_class",
                reason: "user_not_in_class",
            });
        }

        // Send the class permissions as a JSON response
        res.status(200).json({
            success: true,
            data: classData.permissions,
        });
    });

    /**
     * @swagger
     * /api/v1/class/{id}/permissions:
     *   patch:
     *     summary: Update a class permission threshold
     *     tags:
     *       - Class
     *     description: |
     *       Updates a single permission threshold for a class. Each permission controls
     *       the minimum permission level required to perform an action.
     *
     *       **Required Scope:** `class.session.settings`
     *
     *       **Valid permissions:** `links`, `controlPoll`, `manageStudents`, `breakHelp`,
     *       `manageClass`, `auxiliary`, `userDefaults`, `seePoll`, `votePoll`
     *
     *       **Permission Levels:**
     *       - 1: Guest
     *       - 2: Student
     *       - 3: Moderator
     *       - 4: Teacher
     *       - 5: Manager
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
     *               - permission
     *               - level
     *             properties:
     *               permission:
     *                 type: string
     *                 enum: [links, controlPoll, manageStudents, breakHelp, manageClass, auxiliary, userDefaults, seePoll, votePoll]
     *                 description: The permission key to update
     *               level:
     *                 type: integer
     *                 minimum: 1
     *                 maximum: 5
     *                 description: The minimum permission level required (1=Guest, 5=Manager)
     *     responses:
     *       200:
     *         description: Permission threshold updated successfully
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
    router.patch("/class/:id/permissions", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.SETTINGS), async (req, res) => {
        const classId = req.params.id;
        const { permission, level } = req.body;

        if (typeof permission !== "string") {
            throw new ValidationError("Permission must be a string.");
        }

        if (level === undefined) {
            throw new ValidationError("Level is required.");
        }

        req.infoEvent("class.permissions.update", "Updating class permission", { classId, permission });

        await updateClassPermission(classId, permission, level);

        req.infoEvent("class.permissions.updated", "Class permission updated", { classId, permission, level });

        res.status(200).json({ success: true });
    });
};
