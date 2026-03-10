const { STUDENT_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireBodyParam } = require("@modules/error-wrapper");
const digipogService = require("@services/digipog-service");
const AppError = require("@errors/app-error");

module.exports = (router) => {
    router.post("/pool/payout", isAuthenticated, hasPermission(STUDENT_PERMISSIONS), async (req, res) => {
        const { poolId } = req.body || {};

        requireBodyParam(poolId, "poolId");

        req.infoEvent("pool.payout.attempt", "Attempting to pay out a pool", {
            poolId,
            actingUserId: req.user.id,
        });

        const result = await digipogService.payoutPool({
            actingUserId: req.user.id,
            poolId,
        });

        if (!result.success) {
            throw new AppError(result.message, {
                statusCode: 400,
                event: "pool.payout.failed",
                reason: "payout_error",
            });
        }

        req.infoEvent("pool.payout.success", "Pool payout completed successfully", {
            poolId,
            actingUserId: req.user.id,
        });

        res.status(200).json({
            success: true,
            data: result,
        });
    });
};
