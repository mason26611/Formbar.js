const { transferDigipogs } = require("@services/digipog-service");
const { hasScope } = require("@middleware/permission-check");
const { SCOPES } = require("@modules/permissions");
const AppError = require("@errors/app-error");

function normalizeTransferFrom(rawFrom) {
    if (rawFrom === undefined || rawFrom === null || rawFrom === "") {
        return null;
    }

    if (typeof rawFrom === "object") {
        const type = rawFrom.type || "user";
        const id = Number(rawFrom.id ?? rawFrom.userId ?? rawFrom.poolId);
        if (!Number.isInteger(id) || id <= 0 || !["user", "pool"].includes(type)) {
            return null;
        }
        return { id, type };
    }

    const id = Number(rawFrom);
    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }
    return { id, type: "user" };
}

/**
 * * Register transfer controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/digipogs/transfer:
     *   post:
     *     summary: Transfer digipogs to another user
     *     tags:
     *       - Digipogs
     *     description: |
     *       Transfers digipogs from your account to another user.
     *
     *       **Required Scope:** `global.digipogs.transfer` (granted to Student role and above)
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - from
     *               - to
     *               - amount
     *               - pin
     *             properties:
     *               from:
     *                 oneOf:
     *                   - type: integer
     *                   - type: object
     *                 example: 1
     *                 description: Sender account. Required with PIN transfers so the PIN can be checked with a targeted lookup.
     *               to:
     *                 type: string
     *                 example: "user123"
     *                 description: ID of the recipient user
     *               amount:
     *                 type: integer
     *                 example: 5
     *                 description: Number of digipogs to transfer
     *               pin:
     *                 type: string
     *                 example: "1234"
     *                 description: User's PIN for authentication
     *               reason:
     *                 type: string
     *                 example: "Payment for services"
     *                 description: Optional reason for the transfer
     *     responses:
     *       200:
     *         description: Digipogs transferred successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *       400:
     *         description: Missing required fields or invalid amount
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
     *       500:
     *         description: Transfer failed
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.post("/digipogs/transfer", hasScope(SCOPES.GLOBAL.DIGIPOGS.TRANSFER), async (req, res) => {
        const { from: rawFrom, to, amount, pin, reason, pool } = req.body || {};
        const requestedFrom = normalizeTransferFrom(rawFrom);

        if (!requestedFrom) {
            throw new AppError("Missing sender identifier.", {
                statusCode: 400,
                event: "digipogs.transfer.failed",
                reason: "missing_sender",
            });
        }

        const authenticatedUserId = req.user?.id || req.user?.userId;

        if (!authenticatedUserId) {
            throw new AppError("Unable to determine authenticated user for digipogs transfer.", {
                statusCode: 401,
                event: "digipogs.transfer.failed",
                reason: "user_not_found",
            });
        }

        if (!req.pinAuthenticatedFrom && requestedFrom.type === "user" && requestedFrom.id !== authenticatedUserId) {
            throw new AppError("Sender identifier does not match the authenticated user.", {
                statusCode: 403,
                event: "digipogs.transfer.failed",
                reason: "sender_mismatch",
            });
        }

        const from = req.pinAuthenticatedFrom || (requestedFrom.type === "pool" ? requestedFrom : { id: authenticatedUserId, type: "user" });

        req.infoEvent("digipogs.transfer.attempt", "Attempting to transfer digipogs", { from, to, amount });

        const transferPayload = {
            from,
            to,
            amount,
            pin,
            ...(pool !== undefined && { pool }),
            ...(reason !== undefined && { reason }),
        };

        const result = await transferDigipogs(transferPayload);
        if (!result.success) {
            throw new AppError(result.message, { statusCode: 400, event: "digipogs.transfer.failed", reason: "transfer_error" });
        }

        req.infoEvent("digipogs.transfer.success", "Digipogs transferred successfully", { from, to, amount });
        res.status(200).json({
            success: true,
            data: result,
        });
    });
};
