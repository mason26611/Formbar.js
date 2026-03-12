const { classStateStore } = require("@services/classroom-service");
const { CLASS_SOCKET_PERMISSIONS } = require("@modules/permissions");
const { advancedEmitToClass } = require("@services/socket-updates-service");
const { handleSocketError } = require("@modules/socket-error-handler");
const { socketStateStore } = require("@stores/socket-state-store");

module.exports = {
    run(socket, socketUpdates) {
        socket.on("vbTimer", () => {
            try {
                let classData = classStateStore.getClassroom(socket.request.session.classId);
                let email = socket.request.session.email;

                advancedEmitToClass(
                    "vbTimer",
                    socket.request.session.classId,
                    {
                        classPermissions: CLASS_SOCKET_PERMISSIONS.vbTimer,
                        email,
                    },
                    classData.timer
                );
            } catch (err) {
                handleSocketError(err, socket, "vbTimer");
            }
        });

        // This handles the server side timer
        // socket.on("timer", (startTime, active, sound) => {
        //     try {
        //         let classData = classStateStore.getClassroom(socket.request.session.classId);
        //         startTime = Math.round(startTime);
        //
        //         classData.timer.startTime = startTime;
        //         classData.timer.timeLeft = startTime;
        //         classData.timer.active = active;
        //         classData.timer.sound = sound;
        //         socketUpdates.classUpdate();
        //
        //         const classId = socket.request.session.classId;
        //         if (active) {
        //             // Replace any previous timer interval for the class.
        //             socketStateStore.clearRunningTimer(classId);
        //
        //             // Run the function once instantly
        //             socketUpdates.timer(sound, active);
        //
        //             // Save a clock in the class data, which will saves when the page is refreshed
        //             const timerHandle = setInterval(() => socketUpdates.timer(sound, active), 1000);
        //             socketStateStore.setRunningTimer(classId, timerHandle);
        //         } else {
        //             // If the timer is not active, clear the interval
        //             socketStateStore.clearRunningTimer(classId);
        //
        //             socketUpdates.timer(sound, active);
        //         }
        //     } catch (err) {
        //         handleSocketError(err, socket, "timer");
        //     }
        // });

        socket.on("timerOn", () => {
            try {
                socket.emit("timerOn", classStateStore.getClassroom(socket.request.session.classId).timer.active);
            } catch (err) {
                handleSocketError(err, socket, "timerOn");
            }
        });
    },
};
