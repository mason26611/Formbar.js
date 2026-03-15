const { hasScope } = require("@middleware/permission-check");
const { isAuthenticated } = require("@middleware/authentication");
const { requireQueryParam } = require("@modules/error-wrapper");
const { SCOPES } = require("@modules/permissions");
const ValidationError = require("@errors/validation-error");
const classService = require("@services/class-service");

module.exports = (router) => {
    router.post("/class/:id/timer/end", isAuthenticated, hasScope(SCOPES.CLASS.TIMER.CONTROL), async (req, res) => {
        const classId = Number(req.params.id);
        requireQueryParam(classId, "id");

        req.infoEvent("class.timer.end.attempt", "Attempting to end a timer", { classId });

        const timer = classService.getTimer(classId);
        if (timer && !timer.active) {
            throw new ValidationError("Timer is not active.");
        }

        classService.endTimer(classId);

        req.infoEvent("class.timer.end.success", "Ended timer", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
