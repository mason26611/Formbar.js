const { hasClassPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { CLASS_PERMISSIONS } = require("@modules/permissions");
const classService = require("@services/class-service");

module.exports = (router) => {
    router.post("/class/:id/timer/clear", isAuthenticated, hasClassPermission(CLASS_PERMISSIONS.CONTROL_POLLS), async (req, res) => {
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
