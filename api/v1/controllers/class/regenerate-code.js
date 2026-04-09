const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope } = require("@middleware/permission-check");
const { regenerateClassCode } = require("@services/class-service");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    router.post("/class/:id/code/regenerate", isAuthenticated, hasClassScope(SCOPES.CLASS.SESSION.REGENERATE_CODE), async (req, res) => {
        const classId = Number(req.params.id);

        requireQueryParam(classId, "id");

        req.infoEvent("class.code.regenerate.attempt", "Attempting to regenerate class code", { classId });

        const key = await regenerateClassCode(classId);

        req.infoEvent("class.code.regenerate.success", "Class code regenerated", { classId });
        res.status(200).json({
            success: true,
            data: { key },
        });
    });
};
