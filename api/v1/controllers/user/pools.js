const { dbGet } = require("@modules/database");
const { isAuthenticated, isVerified } = require("@middleware/authentication");
const pools = require("@services/digipog-service");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");
const { requireQueryParam } = require("@modules/error-wrapper");

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
         * /api/v1/user/{id}/pools:
         *   get:
         *     summary: Get user's digipog pools
         *     tags:
         *       - Pools
         *     description: Returns all digipog pools that the user owns or is a member of
         *     security:
         *       - bearerAuth: []
         *       - apiKeyAuth: []
         *     parameters:
         *       - in: path
         *         name: id
         *         required: true
         *         description: The ID of the user to retrieve pools for
         *         schema:
         *           type: integer
         *           example: 1
         *       - in: query
         *         name: limit
         *         required: false
         *         description: Number of pools to return per page
         *         schema:
         *           type: integer
         *           minimum: 1
         *           maximum: 100
         *           default: 20
         *       - in: query
         *         name: offset
         *         required: false
         *         description: Number of pools to skip before returning results
         *         schema:
         *           type: integer
         *           minimum: 0
         *           default: 0
         *     responses:
         *       200:
         *         description: Pools retrieved successfully
         *         content:
         *           application/json:
         *             schema:
         *               type: object
         *               properties:
         *                 success:
         *                   type: boolean
         *                   example: true
         *                 data:
         *                   type: object
         *                   properties:
         *                     pools:
         *                       type: string
         *                       description: JSON stringified array of pool objects (legacy format)
         *                     ownedPools:
         *                       type: string
         *                       description: JSON stringified array of owned pool IDs (legacy format)
         *                     memberPools:
         *                       type: string
         *                       description: JSON stringified array of member pool IDs (legacy format)
         *                     poolItems:
         *                       type: array
         *                       items:
         *                         type: object
         *                         additionalProperties: true
         *                     ownedPoolIds:
         *                       type: array
         *                       items:
         *                         type: string
         *                     memberPoolIds:
         *                       type: array
         *                       items:
         *                         type: string
         *                     userId:
         *                       type: integer
         *                     pagination:
         *                       type: object
         *                       properties:
         *                         total:
         *                           type: integer
         *                         limit:
         *                           type: integer
         *                         offset:
         *                           type: integer
         *                         hasMore:
         *                           type: boolean
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
            if (req.user.id !== userId && req.user.permissions < 5) {
                throw new ForbiddenError("You do not have permission to view this user's pools.");
            }

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
