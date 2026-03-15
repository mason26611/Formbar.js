const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const classService = require("@services/class-service");

module.exports = (router) => {
    router.post("/class/:id/timer/clear", isAuthenticated, hasScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        requireQueryParam(classId, "id");

        req.infoEvent("class.timer.clear.attempt", "Attempting to clear a timer", { classId });

        classService.clearTimer(classId);

        req.infoEvent("class.timer.clear.success", "Timer cleared", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
