const {isAuthenticated} = require("@middleware/authentication");
const ValidationError = require("@errors/validation-error");
const {createApp} = require("@services/app-service");

module.exports = (router) => {

    router.post("/apps/register", isAuthenticated, async (req, res) => {
        const {name, description} = req.body;

        req.infoEvent("apps.register.attempt", "User is attempting to register a new app", {name});

        if (!name || !description) {
            throw new ValidationError("Name and description are required to register an app.", 
                {
                    reason: "missing_fields", 
                    event: "apps.register.failed", 
                    details: {name, description}
                }
            );
        }

        const appId = await createApp({name, description, ownerId: req.user.id});

        req.infoEvent("apps.register.success", "App registered successfully", { appId });

        res.json({
            success: true,
            data: { appId }
        });

    });

};
