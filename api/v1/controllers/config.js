const { settings } = require("@modules/config");

module.exports = (router) => {
    router.get("/config", (req, res) => {
        req.infoEvent("config.view.attempt", "Attempting to read the server configuration");
        req.infoEvent("config.view.success", "Server configuration returned");
        res.json({
            success: true,
            data: {
                emailEnabled: settings.emailEnabled,
                googleOauthEnabled: settings.googleOauthEnabled,
            },
        });
    });
};
