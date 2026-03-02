const { isVerified, isAuthenticated } = require("@middleware/authentication");
const { MANAGER_PERMISSIONS } = require("@modules/permissions");
const { getUserDataFromDb } = require("@services/user-service");
const { getUserTransactions } = require("@services/digipog-service");
const { classStateStore } = require("@services/classroom-service");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/transactions:
     *   get:
     *     summary: Get user transaction history
     *     tags:
     *       - Users
     *     description: Returns the transaction history for a user. Users can view their own transactions, or managers can view any user's transactions.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: false
     *         description: The ID of the user to retrieve transactions for (defaults to current user)
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: Transactions retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 transactions:
     *                   type: array
     *                   items:
     *                     type: object
     *                 displayName:
     *                   type: string
     *                 currentUserId:
     *                   type: string
     *       403:
     *         description: Forbidden - insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: User not found
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
    router.get("/user/:id/transactions", isAuthenticated, isVerified, async (req, res) => {
        const userId = Number(req.params.id);
        requireQueryParam(userId, "id");

        // Check if the user has permission to view these transactions (either their own or they are a manager)
        if (req.user.id !== userId && classStateStore.getUser(req.user.email)?.permissions < MANAGER_PERMISSIONS) {
            throw new ForbiddenError("You do not have permission to view these transactions.", {
                event: "user.transactions.view.failed",
                reason: "forbidden",
            });
        }

        const userData = await getUserDataFromDb(userId);
        if (!userData) {
            throw new NotFoundError("User not found.", { event: "user.transactions.view.failed", reason: "user_not_in_database" });
        }

        req.infoEvent("user.transactions.view.attempt", "Attempting to view user transactions", { targetUserId: userId });

        const userDisplayName = userData.displayName || "Unknown User";
        const transactions = await getUserTransactions(userId);
        if (!transactions || transactions.length === 0) {
            req.infoEvent("user.transactions.empty", "No transactions found for user");
            res.status(200).json({
                success: true,
                data: {
                    transactions: [],
                    displayName: userDisplayName,
                    currentUserId: req.user.id,
                },
            });
            return;
        }

        req.infoEvent("user.transactions.view.success", "User transactions returned", { targetUserId: userId });

        res.status(200).json({
            success: true,
            data: {
                transactions: transactions,
                displayName: userDisplayName,
                currentUserId: req.user.id,
            },
        });
    });
};
