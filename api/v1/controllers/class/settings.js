const { hasClassScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { SCOPES } = require("@modules/permissions");
const { updateClassSetting } = require("@services/class-service");

const ValidationError = require("@errors/validation-error");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    router.patch("/class/:id/settings", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.SETTINGS), async (req, res) => {
        const classId = req.params.id;
        const { setting, value } = req.body;

        requireQueryParam(classId, "id");

        if (typeof setting !== "string") {
            throw new ValidationError("Setting must be a string.");
        }

        req.infoEvent("class.settings.update", "Updating class setting", { classId, setting });

        await updateClassSetting(classId, setting, value);

        req.infoEvent("class.settings.updated", "Class setting updated", { classId, setting });

        res.status(200).json({ success: true });
    });
};
