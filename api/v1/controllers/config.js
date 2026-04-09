const { settings } = require("@modules/config");
const { getAvailableProviders } = require("@modules/oidc");

module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/config:
     *   get:
     *     summary: Get server configuration
     *     tags:
     *       - System
     *     description: Returns public server configuration flags indicating which features are enabled.
     *     responses:
     *       200:
     *         description: Server configuration returned successfully
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
     *                     emailEnabled:
     *                       type: boolean
     *                       description: Whether the email service is enabled
     *                     googleOauthEnabled:
     *                       type: boolean
     *                       description: Whether Google OAuth login is enabled
     */
    router.get("/config", (req, res) => {
        req.infoEvent("config.view.attempt", "Attempting to read the server configuration");
        req.infoEvent("config.view.success", "Server configuration returned");
        res.json({
            success: true,
            data: {
                emailEnabled: settings.emailEnabled,
                googleOauthEnabled: settings.googleOauthEnabled,
                oidcProviders: getAvailableProviders(),
            },
        });
    });
};
