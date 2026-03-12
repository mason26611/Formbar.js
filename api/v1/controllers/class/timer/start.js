const { hasClassPermission } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { CLASS_PERMISSIONS } = require("@modules/permissions");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");
const classService = require("@services/class-service");

module.exports = (router) => {
    router.post("/class/:id/timer/start", isAuthenticated, hasClassPermission(CLASS_PERMISSIONS.CONTROL_POLLS), async (req, res) => {
        const classId = Number(req.params.id);
        const { startTime, endTime, sound: playSound } = req.body;
        requireQueryParam(classId, "id");

        if (!startTime || !endTime) {
            throw new ValidationError("Start and end times are required.");
        }

        if (!Number.isInteger(startTime) && !Number.isInteger(endTime)) {
            throw new ForbiddenError("Start and end times must be integers.");
        }

        if (startTime > endTime) {
            throw new ForbiddenError("Start time must be before end time.");
        }

        if (playSound && typeof playSound !== "boolean") {
            throw new ForbiddenError("Sound must be a boolean.");
        }

        req.infoEvent("class.timer.start.attempt", "Attempting to start a timer", { classId });

        classService.startTimer({ classId, startTime, endTime, playSound });

        req.infoEvent("class.timer.start.success", "Timer successfully started", { classId });
        res.status(200).json({
            success: true,
            data: {
                isActive,
            },
        });
    });
};
