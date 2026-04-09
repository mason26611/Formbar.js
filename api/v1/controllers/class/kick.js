const { isAuthenticated } = require("@middleware/authentication");
const { hasClassScope } = require("@middleware/permission-check");
const { classKickStudent, classKickStudents } = require("@services/class-service");
const { advancedEmitToClass } = require("@services/socket-updates-service");
const { SCOPES } = require("@modules/permissions");
const { requireQueryParam } = require("@modules/error-wrapper");

module.exports = (router) => {
    router.post("/class/:id/students/:userId/kick", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.KICK), async (req, res) => {
        const classId = Number(req.params.id);
        const userId = Number(req.params.userId);

        requireQueryParam(classId, "id");
        requireQueryParam(userId, "userId");

        req.infoEvent("class.kick.student.attempt", "Attempting to kick student from class", { classId, userId });

        await classKickStudent(userId, classId, { exitRoom: true, ban: false });
        await advancedEmitToClass("leaveSound", classId, {});

        req.infoEvent("class.kick.student.success", "Student kicked from class", { classId, userId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });

    router.post("/class/:id/students/kick-all", isAuthenticated, hasClassScope(SCOPES.CLASS.STUDENTS.KICK), async (req, res) => {
        const classId = Number(req.params.id);

        requireQueryParam(classId, "id");

        req.infoEvent("class.kick.all.attempt", "Attempting to kick all eligible students from class", { classId });

        await classKickStudents(classId);
        await advancedEmitToClass("kickStudentsSound", classId, { api: true });

        req.infoEvent("class.kick.all.success", "Kicked all students from class", { classId });
        res.status(200).json({
            success: true,
            data: {},
        });
    });
};
