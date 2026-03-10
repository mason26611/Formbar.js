const { STUDENT_PERMISSIONS, MANAGER_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const digipogService = require("@services/digipog-service");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.delete("/pools/:id", isAuthenticated, hasPermission(STUDENT_PERMISSIONS), async (req, res) => {
        const poolId = Number(req.params.id);

        requireQueryParam(poolId, "poolId");

        if (typeof poolId !== "number" || poolId <= 0) {
            throw new ValidationError("Invalid pool ID.", { event: "pool.delete.failed", reason: "invalid_pool_id" });
        }

        // Check if the pool exists
        const pool = await digipogService.getPoolById(poolId);
        if (!pool) {
            throw new ValidationError("Pool does not exist.", { event: "pool.delete.failed", reason: "pool_not_found" });
        }

        // Check if the user owns this pool or is a manager
        const isOwner = await digipogService.isUserOwner(req.user.id, poolId);
        if (!isOwner && req.user.permissions !== MANAGER_PERMISSIONS) {
            throw new ValidationError("You do not own this pool.", { event: "pool.delete.failed", reason: "not_owner" });
        }

        await digipogService.deletePool(poolId);

        res.status(200).send({
            success: true,
            data: {},
        });
    });
};
