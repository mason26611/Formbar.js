const { STUDENT_PERMISSIONS, MANAGER_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireBodyParam } = require("@modules/error-wrapper");
const { dbRun } = require("@modules/database");
const digipogService = require("@services/digipog-service");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.post("/pool/delete", isAuthenticated, hasPermission(STUDENT_PERMISSIONS), async (req, res) => {
        const { poolId } = req.body;

        requireBodyParam(poolId, "poolId");

        if (typeof poolId !== "number" || poolId <= 0) {
            throw new ValidationError("Invalid pool ID.", { event: "pool.delete.failed", reason: "invalid_pool_id" });
        }

        // Check if the user owns this pool
        const isOwner = await digipogService.isUserOwner(req.user.id, poolId);
        if (!isOwner) {
            throw new ValidationError("You do not own this pool.", { event: "pool.delete.failed", reason: "not_owner" });
        }

        // Delete all user associations with this pool
        await dbRun("DELETE FROM digipog_pool_users WHERE pool_id = ?", [poolId]);

        // Delete the pool itself
        await dbRun("DELETE FROM digipog_pools WHERE id = ?", [poolId]);

        res.status(200).send({
            success: true,
            data: {},
        });
    });
};
