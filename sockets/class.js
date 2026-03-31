const { classStateStore } = require("@services/classroom-service");
const { database, dbRun } = require("@modules/database");
const { advancedEmitToClass, setClassOfApiSockets } = require("@services/socket-updates-service");
const { generateKey } = require("@modules/util");
const { io } = require("@modules/web-server");
const { startClass, endClass, leaveClass, isClassActive, joinClass, classKickStudent, classKickStudents } = require("@services/class-service");
const { enrollInClass, unenrollFromClass } = require("@services/class-membership-service");
const { getEmailFromId, getIdFromEmail } = require("@services/student-service");
const { BANNED_PERMISSIONS } = require("@modules/permissions");
const { handleSocketError } = require("@modules/socket-error-handler");
const { classCodeCacheStore } = require("@stores/class-code-cache-store");

module.exports = {
    run(socket, socketUpdates) {
        // Starts a classroom session
        socket.on("startClass", () => {
            try {
                const email = socket.request.session.email;
                const classId = classStateStore.getUser(email).activeClass;
                startClass(classId);
            } catch (err) {
                handleSocketError(err, socket, "startClass", "There was a server error. Please try again");
            }
        });

        // Ends a classroom session
        socket.on("endClass", () => {
            try {
                const email = socket.request.session.email;
                const classId = classStateStore.getUser(email).activeClass;
                endClass(classId, socket.request.session);
            } catch (err) {
                handleSocketError(err, socket, "endClass", "There was a server error. Please try again");
            }
        });

        // Join a classroom session
        socket.on("joinClass", async (classId) => {
            await joinClass(socket.request.session, classId);
        });

        // Enrolls in a classroom by code
        socket.on("joinRoom", async (classCode) => {
            try {
                await enrollInClass(socket.request.session, classCode);
            } catch (err) {
                handleSocketError(err, socket, "joinRoom", "There was a server error. Please try again");
            }
        });

        /**
         * Leaves the classroom session
         * The user is still associated with the class, but they're not active in it
         */
        socket.on("leaveClass", async () => {
            try {
                leaveClass(socket.request.session);
            } catch (err) {
                handleSocketError(err, socket, "leaveClass", "There was a server error. Please try again");
            }
        });

        /**
         * Permanently unenrolls the user from the classroom.
         * The user is no longer associated with the class.
         */
        socket.on("leaveRoom", async () => {
            try {
                await unenrollFromClass(socket.request.session);
            } catch (err) {
                handleSocketError(err, socket, "leaveRoom", "There was a server error. Please try again");
            }
        });

        socket.on("getActiveClass", () => {
            try {
                const api = socket.request.session.api;

                for (const email in classStateStore.getAllUsers()) {
                    const user = classStateStore.getAllUsers()[email];
                    if (user.API == api) {
                        setClassOfApiSockets(api, user.activeClass);
                        return;
                    }
                }

                // If no class is found, set the class to null
                setClassOfApiSockets(api, null);
            } catch (err) {
                handleSocketError(err, socket, "getActiveClass");
            }
        });

        /**
         * Sets a setting for the classroom
         * @param {string} setting - A string representing the setting to change.
         * @param {string} value - The value to set the setting to.
         */
        socket.on("setClassSetting", async (setting, value) => {
            try {
                const classId = socket.request.session.classId;

                // Update the setting in the classInformation and in the database
                classStateStore.updateClassroom(classId, (classroom) => {
                    classroom.settings[setting] = value;
                });
                await dbRun("UPDATE classroom SET settings=? WHERE id= ?", [JSON.stringify(classStateStore.getClassroom(classId).settings), classId]);

                // If the isExcluded setting changed, clear votes from newly excluded students
                if (setting === "isExcluded") {
                    clearVotesFromExcludedStudents(classId);
                }

                // Trigger a class update to sync all clients
                socketUpdates.classUpdate(classId);
            } catch (err) {
                handleSocketError(err, socket, "setClassSetting");
            }
        });

        /**
         * Checks if the class the user is currently in is active
         * Returns true or false on the same event
         */
        socket.on("isClassActive", () => {
            try {
                const isActive = isClassActive(socket.request.session.classId);
                socket.emit("isClassActive", isActive);
            } catch (err) {
                handleSocketError(err, socket, "isClassActive");
            }
        });

        // Regenerates the class code for the classroom in the teacher's session
        socket.on("regenerateClassCode", () => {
            try {
                // Generate a new class code
                const accessCode = generateKey(4);
                const classId = socket.request.session.classId;
                const oldClassCode = classStateStore.getClassroom(classId)?.key;

                // Update the class code in the database
                database.run("UPDATE classroom SET key=? WHERE id= ?", [accessCode, classId], (err) => {
                    try {
                        if (err) throw err;

                        // Update the class code in the class information, session, then refresh the page
                        classStateStore.updateClassroom(classId, { key: accessCode });
                        if (oldClassCode) classCodeCacheStore.delete(oldClassCode);
                        classCodeCacheStore.set(accessCode, classId);
                        socket.emit("reload");
                    } catch (err) {
                        handleSocketError(err, socket, "regenerateClassCode:callback");
                    }
                });
            } catch (err) {
                handleSocketError(err, socket, "regenerateClassCode");
            }
        });

        /**
         * Changes the class name
         * @param {string} name - The new name of the class.
         */
        socket.on("changeClassName", (name) => {
            try {
                if (!name) {
                    socket.emit("message", "Class name cannot be empty.");
                    return;
                }

                // Update the class name in the database
                database.run("UPDATE classroom SET name=? WHERE id= ?", [name, socket.request.session.classId], (err) => {
                    try {
                        if (err) throw err;

                        // Update the class name in the class information
                        classStateStore.updateClassroom(socket.request.session.classId, { className: name });
                        socket.emit("changeClassName", name);
                        socket.emit("message", "Class name updated.");
                    } catch (err) {
                        handleSocketError(err, socket, "changeClassName:callback", "There was a server error try again.");
                    }
                });
            } catch (err) {
                handleSocketError(err, socket, "changeClassName");
            }
        });

        /**
         * Deletes a classroom
         * @param {string} classId - The ID of the classroom to delete.
         */
        socket.on("deleteClass", (classId) => {
            try {
                database.get("SELECT * FROM classroom WHERE id=?", classId, (err, classroom) => {
                    try {
                        if (err) throw err;

                        if (classroom) {
                            if (classStateStore.getClassroom(classId)) {
                                socketUpdates.endClass(classroom.key, classroom.id);
                            }
                            classCodeCacheStore.invalidateByClassId(classroom.id);

                            database.run("DELETE FROM classroom WHERE id=?", classroom.id);
                            database.run("DELETE FROM classusers WHERE classId=?", classroom.id);
                            database.run("DELETE FROM poll_history WHERE class=?", classroom.id);
                        }

                        socketUpdates.getOwnedClasses(socket.request.session.email);
                    } catch (err) {
                        handleSocketError(err, socket, "deleteClass:callback");
                    }
                });
            } catch (err) {
                handleSocketError(err, socket, "deleteClass");
            }
        });

        /**
         * Kicks a user from the classroom
         * @param {string} email - The email of the user to kick.
         */
        socket.on("classKickStudent", async (email) => {
            try {
                const classId = socket.request.session.classId;
                const userId = await getIdFromEmail(email);
                classKickStudent(userId, classId);
                advancedEmitToClass("leaveSound", classId, {});
            } catch (err) {
                handleSocketError(err, socket, "classKickStudent");
            }
        });

        /**
         * Removes a student from the current class session without removing them from the classroom roster.
         * The student will appear as offline on the teacher's page but can rejoin the session.
         * @param {number} userId - The ID of the user to remove from the session.
         */
        socket.on("classRemoveFromSession", (userId) => {
            try {
                logger.log("info", `[classRemoveFromSession] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`);
                logger.log("info", `[classRemoveFromSession] userId=(${userId})`);

                const classId = socket.request.session.classId;
                classKickStudent(userId, classId, { exitRoom: false, ban: false });
            } catch (err) {
                logger.log("error", err.stack);
            }
        });

        // Removes all students from the class
        socket.on("classKickStudents", () => {
            try {
                const classId = socket.request.session.classId;
                classKickStudents(classId);

                socketUpdates.classUpdate(classId);
                advancedEmitToClass("kickStudentsSound", classId, { api: true });
            } catch (err) {
                handleSocketError(err, socket, "classKickStudents");
            }
        });

        /**
         * Bans a user from the classroom
         * @param {string} email - The email of the user to ban.
         */
        socket.on("classBanUser", (email) => {
            try {
                let classId = socket.request.session.classId;

                if (!classId) {
                    socket.emit("message", "You are not in a class");
                    return;
                }

                if (!email) {
                    socket.emit("message", "No email provided. (Please contact the programmer)");
                    return;
                }

                database.run(
                    "UPDATE classusers SET permissions = 0 WHERE classId = ? AND studentId = (SELECT id FROM users WHERE email=?)",
                    [classId, email],
                    (err) => {
                        try {
                            if (err) throw err;

                            if (classStateStore.getClassroomStudent(socket.request.session.classId, email)) {
                                classStateStore.updateClassroomStudent(socket.request.session.classId, email, { classPermissions: 0 });
                            }

                            classKickStudent(email, classId);
                            socketUpdates.classBannedUsersUpdate();
                            socketUpdates.classUpdate();
                            socket.emit("message", `Banned ${email}`);
                        } catch (err) {
                            handleSocketError(err, socket, "classBanUser:callback", "There was a server error try again.");
                        }
                    }
                );
            } catch (err) {
                handleSocketError(err, socket, "classBanUser", "There was a server error try again.");
            }
        });

        /**
         * Unbans a user from the classroom
         * @param {string} email - The email of the user to unban.
         */
        socket.on("classUnbanUser", (email) => {
            try {
                let classId = socket.request.session.classId;

                if (!classId) {
                    socket.emit("message", "You are not in a class");
                    return;
                }

                if (!email) {
                    socket.emit("message", "No email provided. (Please contact the programmer)");
                    return;
                }

                database.run(
                    "UPDATE classusers SET permissions = 1 WHERE classId = ? AND studentId = (SELECT id FROM users WHERE email=?)",
                    [classId, email],
                    (err) => {
                        try {
                            if (err) throw err;

                            if (classStateStore.getClassroomStudent(classId, email)) {
                                classStateStore.updateClassroomStudent(classId, email, { classPermissions: 1 });
                            }

                            // After unbanning, remove the user from the class so they rejoin fresh next time
                            getIdFromEmail(email)
                                .then((userId) => {
                                    classKickStudent(userId, classId, { exitRoom: true, ban: false });
                                    socketUpdates.classUpdate();
                                })
                                .catch(() => {});

                            socketUpdates.classBannedUsersUpdate();
                            socket.emit("message", `Unbanned ${email}`);
                        } catch (err) {
                            handleSocketError(err, socket, "classUnbanUser:callback", "There was a server error try again.");
                        }
                    }
                );
            } catch (err) {
                handleSocketError(err, socket, "classUnbanUser", "There was a server error try again.");
            }
        });

        /**
         * Changes permission of user. Takes which user and the new permission level
         * @param {string} email - The email of the user to change permissions for.
         * @param {number} newPerm - The new permission level to set.
         */
        socket.on("classPermChange", async (userId, newPerm) => {
            try {
                const email = await getEmailFromId(userId);
                const classId = socket.request.session.classId;

                // Prevent changing the owner's permissions
                const classroom = classStateStore.getClassroom(classId);
                if (classroom.owner == userId) {
                    socket.emit("message", "You cannot change the permissions of the class owner.");
                    return;
                }

                const oldPerm = classStateStore.getClassroomStudent(classId, email).classPermissions || BANNED_PERMISSIONS;

                // Update the permission in the classInformation and in the database
                classStateStore.updateClassroomStudent(classId, email, { classPermissions: newPerm });
                classStateStore.updateUser(email, { classPermissions: newPerm });
                await dbRun("UPDATE classusers SET permissions=? WHERE classId=? AND studentId=?", [
                    newPerm,
                    classroom.id,
                    classStateStore.getClassroomStudent(classId, email).id,
                ]);

                // If the new permission is BANNED_PERMISSIONS, kick the user from the class and ban them
                if (newPerm === BANNED_PERMISSIONS) {
                    classKickStudent(userId, classId, { exitRoom: true, ban: true });
                    advancedEmitToClass("leaveSound", classId, {});
                    socketUpdates.classUpdate();
                    return;
                }

                // If the student's previous permissions were banned and the new permissions are higher, then
                // kick them from the class to allow them to rejoin. Await to ensure UI reflects immediately.
                if (oldPerm === BANNED_PERMISSIONS && newPerm > BANNED_PERMISSIONS) {
                    await classKickStudent(userId, classId, { exitRoom: true, ban: false });
                    socketUpdates.classUpdate();
                    return;
                }

                // Reload the user's page and update the class
                io.to(`user-${email}`).emit("reload");
                socketUpdates.classUpdate();
            } catch (err) {
                handleSocketError(err, socket, "classPermChange");
            }
        });

        /**
         * Sets the permission settings for the classroom
         * @param {string} permission - The permission to set.
         * @param {number} level - The level to set the permission to.
         * This can be 1, 2, 3, 4, 5 with guest permissions being 1.
         */
        socket.on("setClassPermissionSetting", async (permission, level) => {
            try {
                const classId = socket.request.session.classId;
                classStateStore.updateClassroom(classId, (classroom) => {
                    classroom.permissions[permission] = level;
                });
                dbRun(`UPDATE class_permissions SET ${permission}=? WHERE classId=?`, [level, classId]).catch((err) => {
                    handleSocketError(err, socket, "setClassPermissionSetting:dbRun");
                });
                socketUpdates.classUpdate(classId);
            } catch (err) {
                handleSocketError(err, socket, "setClassPermissionSetting");
            }
        });

        socket.on("updateExcludedRespondents", (respondants) => {
            try {
                const classId = socket.request.session.classId;
                const classroom = classStateStore.getClassroom(classId);
                if (!Array.isArray(respondants)) return;

                // Contains the list of student IDs who should be excluded from the poll
                const excludedRespondents = [...respondants];

                // Also automatically exclude students who are offline, on break, or have excluded tag
                for (const studentEmail of Object.keys(classroom.students)) {
                    const student = classroom.students[studentEmail];
                    const studentId = student.id;

                    // If the student doesn't exist, is offline/excluded, or is on break, add them to excluded list
                    if (
                        (!student || (student.tags && (student.tags.includes("Offline") || student.tags.includes("Excluded"))) || student.onBreak) &&
                        !excludedRespondents.includes(studentId)
                    ) {
                        excludedRespondents.push(studentId);
                    }
                }

                // Update both excludedRespondent properties to keep them in sync
                classroom.poll.excludedRespondents = excludedRespondents;

                // Clear votes from newly excluded students
                clearVotesFromExcludedStudents(classId);

                socketUpdates.classUpdate(classId);
            } catch (err) {
                handleSocketError(err, socket, "updateExcludedRespondents");
            }
        });
    },
};
