const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const { hasScope } = require("@middleware/permission-check");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");
const classService = require("@services/class-service");
const { classStateStore } = require("@services/classroom-service");

module.exports = (router) => {
    router.post("/class/:id/timer/start", isAuthenticated, hasScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        let { duration, sound } = req.body;
        requireQueryParam(classId, "id");

        if (!duration) {
            throw new ValidationError("Duration is required.");
        }

        duration = Number(duration);

        if (!Number.isInteger(duration)) {
            throw new ForbiddenError("Duration must be an integer.");
        }

        if (sound && typeof sound !== "boolean") {
            throw new ForbiddenError("Sound must be a boolean.");
        }

        req.infoEvent("class.timer.start.attempt", "Attempting to start a timer", { classId });

        const classroom = classStateStore.getClassroom(classId);
        if (!classroom) {
            throw new ForbiddenError("Classroom is not currently loaded.");
        }

        classService.startTimer({ classId, duration, sound });

        req.infoEvent("class.timer.start.success", "Timer successfully started", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
