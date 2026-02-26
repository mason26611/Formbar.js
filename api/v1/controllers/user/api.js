const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const userService = require("@services/user-service");

module.exports = (router) => {
    router.post("/user/:id/api/regenerate", isAuthenticated, async (req, res) => {
        const userId = req.params.id;
        requireQueryParam(userId, "id");

        req.infoEvent("user.api.view", "Attempting to regenerate user API key", { targetUserId: userId });
        const apiKey = await userService.regenerateAPIKey(userId);
        req.infoEvent("user.api.regenerate.success", "User API key regenerated", { targetUserId: userId });

        res.status(200).json({
            success: true,
            data: {
                apiKey: apiKey,
            },
        });
    });
};
