const { STUDENT_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireBodyParam } = require("@modules/error-wrapper");
const digipogService = require("@services/digipog-service");
const AppError = require("@errors/app-error");

module.exports = (router) => {
    router.post("/pool/add-member", isAuthenticated, hasPermission(STUDENT_PERMISSIONS), async (req, res) => {
        const { poolId, userId } = req.body || {};

        requireBodyParam(poolId, "poolId");
        requireBodyParam(userId, "userId");

        req.infoEvent("pool.add_member.attempt", "Attempting to add a user to a pool", {
            poolId,
            userId,
            actingUserId: req.user.id,
        });

        const result = await digipogService.addMemberToPool({
            actingUserId: req.user.id,
            poolId,
            userId,
        });

        if (!result.success) {
            throw new AppError(result.message, {
                statusCode: 400,
                event: "pool.add_member.failed",
                reason: "add_member_error",
            });
        }

        req.infoEvent("pool.add_member.success", "User added to pool successfully", {
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
