const { dbGet } = require("@modules/database");
const { isAuthenticated, isVerified } = require("@middleware/authentication");
const pools = require("@services/digipog-service");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = {
    run(router) {
        /**
         * @swagger
         * /api/v1/user/:id/pools:
         *   get:
         *     summary: Get user's digipog pools
         *     tags:
         *       - Pools
         *     description: Returns all digipog pools that the user owns or is a member of
         *     security:
         *       - bearerAuth: []
         *       - apiKeyAuth: []
         *     responses:
         *       200:
         *         description: Pools retrieved successfully
         *         content:
         *           application/json:
         *             schema:
         *               type: object
         *               properties:
         *                 pools:
         *                   type: string
         *                   description: JSON stringified array of pool objects
         *                 ownedPools:
         *                   type: string
         *                   description: JSON stringified array of owned pool IDs
         *                 memberPools:
         *                   type: string
         *                   description: JSON stringified array of member pool IDs
         *                 userId:
         *                   type: string
         *       500:
         *         description: Server error
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/ServerError'
         */
        // Handle displaying the pools management page
        router.get("/user/:id/pools", isAuthenticated, isVerified, async (req, res) => {
            const userId = Number(req.params.id);
            requireQueryParam(userId, "id");

            req.infoEvent("user.pools.view.attempt", "Attempting to view user pools");

            // Get all pools for this user using the new schema helper
            const userPools = await pools.getPoolsForUser(userId);
            const ownedPools = userPools.filter((p) => p.owner).map((p) => String(p.pool_id));
            const memberPools = userPools.filter((p) => !p.owner).map((p) => String(p.pool_id));
            const poolObjs = await Promise.all(
                userPools.map(async (poolData) => {
                    const pool = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [poolData.pool_id]);
                    if (pool) {
                        const users = await pools.getUsersForPool(poolData.pool_id);
                        pool.members = users.filter((userData) => !userData.owner).map((u) => u.user_id);
                        pool.owners = users.filter((userData) => userData.owner).map((u) => u.user_id);
                    }
                    return pool;
                })
            );

            req.infoEvent("user.pools.view.success", "User pools returned", { poolCount: poolObjs.filter((p) => p).length });
            res.status(200).json({
                success: true,
                data: {
                    pools: JSON.stringify(poolObjs.filter((p) => p)), // Filter out null values
                    ownedPools: JSON.stringify(ownedPools),
                    memberPools: JSON.stringify(memberPools),
                    userId: userId,
                },
            });
        });
    },
};
