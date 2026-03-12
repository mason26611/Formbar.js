const { hasClassPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { CLASS_PERMISSIONS } = require("@modules/permissions");
const classService = require("@services/class-service");

module.exports = (router) => {
    router.post("/class/:id/timer/start", isAuthenticated, hasClassPermission(CLASS_PERMISSIONS.CONTROL_POLLS), async (req, res) => {
        const classId = Number(req.params.id);
        requireQueryParam(classId, "id");

        req.infoEvent("class.timer.end.attempt", "Attempting to end a timer", { classId });

        classService.endTimer(classId);

        req.infoEvent("class.timer.end.success", "Timer ended", { classId });
        res.status(200).json({
            success: true,
            data: {
                isActive,
            },
        });
    });
};
