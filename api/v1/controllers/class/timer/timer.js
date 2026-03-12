const { classStateStore } = require("@services/classroom-service");
const { isAuthenticated } = require("@middleware/authentication");
const ForbiddenError = require("@errors/forbidden-error");
const classService = require("@services/class-service");

module.exports = (router) => {
    router.get("/class/:id/timer", isAuthenticated, async (req, res) => {
        const classId = req.params.id;
        req.infoEvent("class.timer.view.attempt", "Attempting to view class timer", { classId });

        const classroom = classStateStore.getClassroom(classId);
        if (classroom && !classroom.students[req.user.email]) {
            throw new ForbiddenError("You do not have permission to view the status of this class.");
        }

        const isActive = classService.getTimer(classId);

        req.infoEvent("class.timer.view.success", "Class timer returned", { classId, isActive });
        res.status(200).json({
            success: true,
            data: {
                isActive,
            },
        });
    });
};
