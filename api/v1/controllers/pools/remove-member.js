const { STUDENT_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireBodyParam, requireQueryParam } = require("@modules/error-wrapper");
const digipogService = require("@services/digipog-service");
const AppError = require("@errors/app-error");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.post("/pools/:id/remove-member", isAuthenticated, hasPermission(STUDENT_PERMISSIONS), async (req, res) => {
        const poolId = Number(req.params.id);
        let { userId } = req.body || {};

        requireQueryParam(poolId, "poolId");
        requireBodyParam(userId, "userId");
        userId = Number(userId);

        req.infoEvent("pool.remove_member.attempt", "Attempting to remove a user from a pool", {
            poolId,
            userId,
            actingUserId: req.user.id,
        });

        // Check if the pool exists
        const pool = await digipogService.getPoolById(poolId);
        if (!pool) {
            throw new ValidationError("Pool does not exist.", { event: "pool.delete.failed", reason: "pool_not_found" });
        }

        const result = await digipogService.removeMemberFromPool({
            actingUserId: req.user.id,
            poolId,
            userId,
        });

        if (!result.success) {
            throw new AppError(result.message, {
                statusCode: 400,
                event: "pool.remove_member.failed",
                reason: "remove_member_error",
            });
        }

        req.infoEvent("pool.remove_member.success", "User removed from pool successfully", {
            poolId,
            userId,
            actingUserId: req.user.id,
        });

        res.status(200).json({
            success: true,
            data: result,
        });
    });
};
