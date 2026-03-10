const { STUDENT_PERMISSIONS, MANAGER_PERMISSIONS } = require("@modules/permissions");
const { hasPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireBodyParam } = require("@modules/error-wrapper");
const { dbRun } = require("@modules/database");
const digipogService = require("@services/digipog-service");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.post("/pool/create", isAuthenticated, hasPermission(STUDENT_PERMISSIONS), async (req, res) => {
        const { name, description } = req.body;

        requireBodyParam(name, "name");
        requireBodyParam(description, "description");

        if (typeof name !== "string" || name.length <= 0 || name.length > 50) {
            throw new ValidationError("Invalid pool name.", { event: "pool.create.failed", reason: "invalid_name" });
        }

        if (typeof description !== "string" || description.length > 255) {
            throw new ValidationError("Invalid pool description.", { event: "pool.create.failed", reason: "invalid_description" });
        }

        // Check if the pools limit has been reached
        // If the user is a manager, they can create as many pools as they want
        const userPools = await digipogService.getPoolsForUser(req.user.id);
        const ownedPools = userPools.filter((pool) => pool.owner);
        if (ownedPools.length >= 5 && req.user.permissions !== MANAGER_PERMISSIONS) {
            throw new ValidationError("You can only own up to 5 pools.", { event: "pool.create.failed", reason: "max_pools" });
        }

        // Create the pool
        const result = await dbRun("INSERT INTO digipog_pools (name, description, amount) VALUES (?, ?, 0)", [name, description]);
        const poolId = result.lastID || result;

        // Add the user as the pool owner using the new structure
        await digipogService.addUserToPool(poolId, req.user.id, 1);

        res.status(200).send({
            success: true,
            data: {
                poolId: poolId,
            },
        });
    });
};
