const { dbGet } = require("@modules/database");
const { isAuthenticated, isVerified } = require("@middleware/authentication");
const pools = require("@services/digipog-service");
const ValidationError = require("@errors/validation-error");

const DEFAULT_POOL_LIMIT = 20;
const MAX_POOL_LIMIT = 100;

function parseIntegerQueryParam(value, defaultValue) {
    if (value == null) {
        return defaultValue;
    }

    const normalized = String(value).trim();
    if (!/^-?\d+$/.test(normalized)) {
        return NaN;
    }

    return Number.parseInt(normalized, 10);
}

module.exports = {
    run(router) {
        /**
         * @swagger
         * /api/v1/user/pools:
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
        router.get("/user/pools", isAuthenticated, isVerified, async (req, res) => {
            const userId = req.user.id;
            req.infoEvent("user.pools.view.attempt", "Attempting to view user pools");

            const limit = parseIntegerQueryParam(req.query.limit, DEFAULT_POOL_LIMIT);
            const offset = parseIntegerQueryParam(req.query.offset, 0);

            if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POOL_LIMIT) {
                throw new ValidationError(`Invalid limit. Expected an integer between 1 and ${MAX_POOL_LIMIT}.`);
            }

            if (!Number.isInteger(offset) || offset < 0) {
                throw new ValidationError("Invalid offset. Expected a non-negative integer.");
            }

            const { pools: userPools, total } = await pools.getPoolsForUserPaginated(userId, limit, offset);

            const ownedPools = userPools.filter((p) => p.owner).map((p) => String(p.pool_id));
            const memberPools = userPools.filter((p) => !p.owner).map((p) => String(p.pool_id));
            const poolObjs = await Promise.all(
                userPools.map(async (p) => {
                    const pool = await dbGet("SELECT * FROM digipog_pools WHERE id = ?", [p.pool_id]);
                    if (pool) {
                        const users = await pools.getUsersForPool(p.pool_id);
                        pool.members = users.filter((u) => !u.owner).map((u) => u.user_id);
                        pool.owners = users.filter((u) => u.owner).map((u) => u.user_id);
                    }
                    return pool;
                })
            );
            const filteredPools = poolObjs.filter((p) => p);
            const hasMore = offset + filteredPools.length < total;

            req.infoEvent("user.pools.view.success", "User pools returned", {
                poolCount: filteredPools.length,
                totalPoolCount: total,
                limit,
                offset,
            });
            res.status(200).json({
                success: true,
                data: {
                    pools: JSON.stringify(filteredPools), // backwards-compatible format
                    ownedPools: JSON.stringify(ownedPools),
                    memberPools: JSON.stringify(memberPools),
                    poolItems: filteredPools,
                    ownedPoolIds: ownedPools,
                    memberPoolIds: memberPools,
                    userId: userId,
                    pagination: {
                        total,
                        limit,
                        offset,
                        hasMore,
                    },
                },
            });
        });
    },
};
