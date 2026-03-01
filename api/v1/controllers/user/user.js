const { classStateStore } = require("@services/classroom-service");
const { MANAGER_PERMISSIONS } = require("@modules/permissions");
const { getUserDataFromDb } = require("@services/user-service");
const { isAuthenticated } = require("@middleware/authentication");
const NotFoundError = require("@errors/not-found-error");
const AppError = require("@errors/app-error");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}:
     *   get:
     *     summary: Get user information by ID
     *     tags:
     *       - Users
     *     description: |
     *       Returns information about a user including profile data (digipogs, API status,
     *       PIN status, pogMeter). The user's email address is only included when the
     *       requester is the user themselves or a manager. API key and PIN existence are
     *       only surfaced for the user's own profile.
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the user to retrieve
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: User information returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/User'
     *       401:
     *         description: Unauthorized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/UnauthorizedError'
     *       404:
     *         description: User not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     */
    router.get("/user/:id", async (req, res) => {
        const userId = req.params.id;
        req.infoEvent("user.view.attempt", "Attempting to view user by id", { targetUserId: userId });

        const userData = await getUserDataFromDb(userId);
        if (!userData) {
            throw new NotFoundError("User not found.", { event: "user.get.failed", reason: "user_not_found" });
        }

        const { id, displayName, email, digipogs, API, pin, permissions, verified } = userData;
        if (!id || !displayName || !email || digipogs === undefined || !API) {
            throw new AppError("Unable to retrieve user information. Please try again.", {
                event: "user.get.failed",
                reason: "missing_required_fields",
            });
        }

        const requesterEmail = req.user?.email;
        const isManager = requesterEmail && classStateStore.getUser(requesterEmail)?.permissions >= MANAGER_PERMISSIONS;
        const isOwnProfile = String(req.user?.id) === String(userId);
        const emailVisible = isOwnProfile || isManager;

        // Load in-memory state for live pogMeter
        const liveUser = classStateStore.getUser(email);

        req.infoEvent("user.view.success", "User data returned", { targetUserId: userId });
        res.status(200).json({
            success: true,
            data: {
                id: id,
                displayName: displayName,
                email: emailVisible ? email : undefined,
                hasPin: isOwnProfile ? Boolean(pin) : undefined,
                permissions: permissions,
                verified: verified,
                digipogs: digipogs,
                pogMeter: liveUser ? liveUser.pogMeter : 0,
            },
        });
    });
};
