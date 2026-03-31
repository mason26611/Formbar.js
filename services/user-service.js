const handlebars = require("handlebars");
const fs = require("fs");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const AppError = require("@errors/app-error");
const NotFoundError = require("@errors/not-found-error");
const { sendMail } = require("@modules/mail");
const { dbGet, dbRun, dbGetAll, database } = require("@modules/database");
const { frontendUrl } = require("@modules/config");
const { classStateStore } = require("@services/classroom-service");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");
const { socketStateStore } = require("@stores/socket-state-store");
const { getUserRoleName } = require("@modules/scope-resolver");
const { ROLE_NAMES } = require("@modules/roles");
const { handleSocketError } = require("@modules/socket-error-handler");
const { managerUpdate, userUpdateSocket } = require("@services/socket-updates-service");
const { endClass } = require("@services/class-service");
const { deleteClassrooms } = require("@services/class-service");
const { deleteCustomPolls } = require("@services/poll-service");
const { hash } = require("@modules/crypto");
const { requireInternalParam } = require("@modules/error-wrapper");
const { getEmailFromId } = require("@services/student-service");

let passwordResetTemplate;
let verifyEmailTemplate;
let pinResetTemplate;

function loadPasswordResetTemplate() {
    if (passwordResetTemplate) {
        return passwordResetTemplate;
    }

    try {
        const resetEmailContent = fs.readFileSync("email-templates/password-reset.hbs", "utf8");
        passwordResetTemplate = handlebars.compile(resetEmailContent);
        return passwordResetTemplate;
    } catch (err) {
        // Log the underlying error for diagnostics, but throw a controlled error outward.
        console.error("Failed to load password reset email template:", err);
        throw new AppError("Failed to load password reset email template.", {
            statusCode: 500,
            event: "user.password.reset.failed",
            reason: "template_load_error",
        });
    }
}

function loadPinResetTemplate() {
    if (pinResetTemplate) {
        return pinResetTemplate;
    }

    try {
        const pinResetEmailContent = fs.readFileSync("email-templates/pin-reset.hbs", "utf8");
        pinResetTemplate = handlebars.compile(pinResetEmailContent);
        return pinResetTemplate;
    } catch (err) {
        console.error("Failed to load PIN reset email template:", err);
        throw new AppError("Failed to load PIN reset email template.", {
            statusCode: 500,
            event: "user.pin.reset.failed",
            reason: "template_load_error",
        });
    }
}

async function requestPinReset(userId) {
    requireInternalParam(userId, "userId");

    const user = await getUserDataFromDb(userId);
    if (!user) {
        throw new NotFoundError("User not found.", {
            event: "user.pin.reset.request.failed",
            reason: "user_not_found",
        });
    }

    const template = loadPinResetTemplate();
    const token = crypto.randomBytes(64).toString("hex");
    await dbRun("UPDATE users SET secret = ? WHERE id = ?", [token, userId]);

    sendMail(user.email, "Formbar PIN Reset", template({ resetUrl: `${frontendUrl}/user/me/pin?code=${token}` }));
}

async function resetPin(newPin, token) {
    requireInternalParam(newPin, "newPin");
    requireInternalParam(token, "token");

    const user = await dbGet("SELECT * FROM users WHERE secret = ?", [token]);
    if (!user) {
        throw new NotFoundError("PIN reset token is invalid or has expired.", {
            event: "user.pin.reset.failed",
            reason: "invalid_token",
        });
    }

    const hashedPin = await hash(String(newPin));
    await dbRun("UPDATE users SET pin = ? WHERE id = ?", [hashedPin, user.id]);
}

async function updatePin(userId, oldPin, newPin) {
    requireInternalParam(userId, "userId");
    requireInternalParam(newPin, "newPin");

    const user = await getUserDataFromDb(userId);
    if (!user) {
        throw new NotFoundError("User not found.", {
            event: "user.pin.update.failed",
            reason: "user_not_found",
        });
    }

    // If user already has a PIN, verify the old one matches
    if (user.pin) {
        requireInternalParam(oldPin, "oldPin");
        const oldPinMatches = await bcrypt.compare(String(oldPin), user.pin);
        if (!oldPinMatches) {
            const AuthError = require("@errors/auth-error");
            throw new AuthError("Current PIN is incorrect.", {
                event: "user.pin.update.failed",
                reason: "incorrect_old_pin",
            });
        }
    }

    const hashedPin = await hash(String(newPin));
    await dbRun("UPDATE users SET pin = ? WHERE id = ?", [hashedPin, userId]);
}

async function verifyPin(userId, pin) {
    requireInternalParam(userId, "userId");
    requireInternalParam(pin, "pin");

    const user = await getUserDataFromDb(userId);
    if (!user) {
        throw new NotFoundError("User not found.", {
            event: "user.pin.verify.failed",
            reason: "user_not_found",
        });
    }

    if (!user.pin) {
        throw new AppError("No PIN is set for this account. Please create one first.", {
            statusCode: 400,
            event: "user.pin.verify.failed",
            reason: "pin_not_set",
        });
    }

    const pinMatches = await bcrypt.compare(String(pin), user.pin);
    if (!pinMatches) {
        const AuthError = require("@errors/auth-error");
        throw new AuthError("PIN is incorrect.", {
            event: "user.pin.verify.failed",
            reason: "incorrect_pin",
        });
    }

    return true;
}

function loadVerifyEmailTemplate() {
    if (verifyEmailTemplate) {
        return verifyEmailTemplate;
    }

    try {
        const verifyEmailContent = fs.readFileSync("email-templates/verify-email.hbs", "utf8");
        verifyEmailTemplate = handlebars.compile(verifyEmailContent);
        return verifyEmailTemplate;
    } catch (err) {
        console.error("Failed to load verification email template:", err);
        throw new AppError("Failed to load verification email template.", {
            statusCode: 500,
            event: "user.verify.email.failed",
            reason: "template_load_error",
        });
    }
}

async function getUserDataFromDb(userId) {
    const user = await dbGet("SELECT * FROM users WHERE id = ?", [userId]);
    return user;
}

async function requestPasswordReset(email) {
    const template = loadPasswordResetTemplate();
    const secret = crypto.randomBytes(256).toString("hex");
    await dbRun("UPDATE users SET secret = ? WHERE email = ?", [secret, email]);

    sendMail(email, "Formbar Password Change", template({ resetUrl: `${frontendUrl}/user/me/password?code=${secret}` }));
}

async function requestVerificationEmail(userId, apiBaseUrl) {
    requireInternalParam(userId, "userId");

    const user = await dbGet("SELECT id, email, verified FROM users WHERE id = ?", [userId]);
    if (!user) {
        throw new NotFoundError("User not found.", {
            event: "user.verify.email.failed",
            reason: "user_not_found",
        });
    }

    if (user.verified) {
        return { alreadyVerified: true };
    }

    const template = loadVerifyEmailTemplate();
    const secret = crypto.randomBytes(256).toString("hex");
    const verifyUrl = frontendUrl ? `${frontendUrl}/user/verify/email?code=${secret}` : `${apiBaseUrl}/api/v1/user/verify/email?code=${secret}`;

    await dbRun("UPDATE users SET secret = ? WHERE id = ?", [secret, user.id]);
    sendMail(user.email, "Formbar Email Verification", template({ verifyUrl }));

    return { alreadyVerified: false };
}

async function verifyEmailFromCode(code) {
    requireInternalParam(code, "code");

    const user = await dbGet("SELECT id, email, verified FROM users WHERE secret = ?", [code]);
    if (!user) {
        throw new NotFoundError("Verification token is invalid or has expired.", {
            event: "user.verify.email.failed",
            reason: "invalid_code",
        });
    }

    if (!user.verified) {
        await dbRun("UPDATE users SET verified = 1 WHERE id = ?", [user.id]);
        if (classStateStore.getUser(user.email)) {
            classStateStore.updateUser(user.email, { verified: 1 });
        }
    }

    return { userId: user.id, alreadyVerified: Boolean(user.verified) };
}

async function resetPassword(password, token) {
    requireInternalParam(password, "password");
    requireInternalParam(token, "token");

    const user = await dbGet("SELECT * FROM users WHERE secret = ?", [token]);
    if (!user) {
        throw new NotFoundError("Password reset token is invalid or has expired.", {
            event: "user.password.reset.failed",
            reason: "invalid_token",
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, user.id]);
    return true;
}

async function regenerateAPIKey(userId) {
    requireInternalParam(userId, "userId");

    const user = await getUserDataFromDb(userId);
    if (!user) {
        throw new NotFoundError("User not found for API key regeneration.", {
            event: "user.api_key.regenerate.failed",
            reason: "user_not_found",
        });
    }

    // Generate a new API key for the user
    const apiKey = crypto.randomBytes(32).toString("hex");
    const hashedAPIKey = await hash(apiKey);
    await dbRun("UPDATE users SET API = ? WHERE id = ?", [hashedAPIKey, userId]);

    // Invalidate the cache for the user's email
    const email = await getEmailFromId(userId);
    if (email) {
        apiKeyCacheStore.invalidateByEmail(email);
    } else {
        apiKeyCacheStore.clear();
    }

    return apiKey;
}

// User lookup

/**
 * Gets the class id for the given user by checking in-memory classrooms.
 */
function getUserClass(email) {
    try {
        const allClassrooms = classStateStore.getAllClassrooms();
        for (const classroomId in allClassrooms) {
            const classroom = allClassrooms[classroomId];
            if (classroom.students[email]) {
                return classroom.id;
            }
        }
        return null;
    } catch (err) {
        return err;
    }
}

/**
 * Gets the email associated with an API key, with caching.
 */
async function getEmailFromAPIKey(api) {
    try {
        if (!api) return { error: "Missing API key" };

        const cachedEmail = apiKeyCacheStore.get(api);
        if (cachedEmail) return cachedEmail;

        let user = await new Promise((resolve, reject) => {
            database.all("SELECT * FROM users", [], async (err, users) => {
                try {
                    if (err) throw err;
                    let userData = null;
                    for (const user of users) {
                        if (user.API && (await bcrypt.compare(api, user.API))) {
                            userData = user;
                            break;
                        }
                    }
                    if (!userData) {
                        resolve({ error: "Not a valid API key" });
                        return;
                    }
                    resolve(userData);
                } catch (err) {
                    reject(err);
                }
            });
        });

        if (user.error) return user;
        apiKeyCacheStore.set(api, user.email);
        return user.email;
    } catch (err) {
        return err;
    }
}

/**
 * Gets the current user's data including class/session info.
 */
async function getUser(userIdentifier) {
    try {
        const email = userIdentifier.email || (await getEmailFromAPIKey(userIdentifier.api));
        if (email instanceof Error) throw email;
        if (email.error) throw email;

        let classId = getUserClass(email);
        if (classId instanceof Error) throw classId;

        let dbUser = await new Promise((resolve, reject) => {
            if (!classId) {
                database.get("SELECT id, email, permissions, NULL AS classPermissions FROM users WHERE email = ?", [email], (err, dbUser) => {
                    try {
                        if (err) throw err;
                        if (!dbUser) {
                            resolve({ error: "user does not exist" });
                            return;
                        }
                        resolve(dbUser);
                    } catch (err) {
                        reject(err);
                    }
                });
                return;
            }
            database.get(
                "SELECT users.id, users.email, users.permissions, CASE WHEN users.id = classroom.owner THEN 5 ELSE classusers.permissions END AS classPermissions FROM users JOIN classroom ON classroom.id = ? LEFT JOIN classusers ON classusers.classId = classroom.id AND classusers.studentId = users.id WHERE users.email = ?;",
                [classId, email],
                (err, dbUser) => {
                    try {
                        if (err) throw err;
                        if (!dbUser) {
                            resolve({ error: "user does not exist in this class" });
                            return;
                        }
                        resolve(dbUser);
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });

        if (dbUser.error) return dbUser;

        let userData = { loggedIn: false, ...dbUser, help: null, break: null, pogMeter: 0, classId };

        const classroom = classStateStore.getClassroom(classId);
        if (classroom && classroom.students[dbUser.email]) {
            let cdUser = classroom.students[dbUser.email];
            if (cdUser) {
                userData.loggedIn = true;
                userData.help = cdUser.help;
                userData.break = cdUser.break;
                userData.pogMeter = cdUser.pogMeter;
            }
        }

        return userData;
    } catch (err) {
        return err;
    }
}

/**
 * Gets the classes owned by a user from their email.
 */
async function getUserOwnedClasses(email) {
    const userId = (await dbGet("SELECT id FROM users WHERE email = ?", [email])).id;
    return dbGetAll("SELECT * FROM classroom WHERE owner=?", [userId]);
}

// Session Management

/**
 * Logs a user out from a specific socket, cleaning up session state.
 */
function logout(socket) {
    const email = socket.request.session.email;
    const userId = socket.request.session.userId;
    const classId = socket.request.session.classId;

    let isLastSession = false;
    const { emptyAfterRemoval } = socketStateStore.removeUserSocket(email, socket.id);
    isLastSession = emptyAfterRemoval;

    if (classId) socket.leave(`class-${classId}`);

    socket.request.session.destroy((err) => {
        try {
            if (err) throw err;
            socket.emit("reload");
            socketStateStore.removeLastActivity(email, socket.id);

            if (isLastSession) {
                const user = classStateStore.getUser(email);
                if (user) {
                    user.activeClass = null;
                    user.break = false;
                    user.help = false;
                    user.classPermissions = null;
                }
                if (user && getUserRoleName(user) === ROLE_NAMES.GUEST) {
                    classStateStore.removeUser(email);
                }
                if (!classId) return;

                const classroom = classStateStore.getClassroom(classId);
                if (classroom) {
                    const student = classroom.students[email];
                    if (student) {
                        if (student.isGuest) {
                            delete classroom.students[email];
                        } else {
                            student.activeClass = null;
                            student.break = false;
                            student.help = false;
                            if (student.tags && !student.tags.includes("Offline")) {
                                student.tags.push("Offline");
                            } else if (!student.tags) {
                                student.tags = ["Offline"];
                            }
                        }
                    }
                    userUpdateSocket(email, "classUpdate", classId);
                }

                database.get("SELECT * FROM classroom WHERE owner=? AND id=?", [userId, classId], (err, classroom) => {
                    if (err) {
                        handleSocketError(err, socket, "logout:database");
                    }
                    if (classroom) {
                        endClass(classroom.id);
                    }
                });
            }
        } catch (err) {
            handleSocketError(err, socket, "logout");
        }
    });
}

/**
 * Deletes a user account and all associated data.
 */
async function deleteUser(userId, userSession) {
    try {
        const user = await dbGet("SELECT * FROM users WHERE id=?", [userId]);
        let tempUser;
        if (!user) {
            tempUser = await dbGet("SELECT * FROM temp_user_creation_data WHERE secret=?", [userId]);
            if (!tempUser) return "User not found";
            await dbRun("DELETE FROM temp_user_creation_data WHERE secret=?", [userId]);
        }

        const userSocketsMap = socketStateStore.getUserSocketsByEmail(user ? user.email : tempUser.email);
        if (userSocketsMap) {
            const anySocket = Object.values(userSocketsMap)[0];
            if (anySocket) logout(anySocket);
        }

        try {
            if (user) {
                await dbRun("BEGIN TRANSACTION");
                await Promise.all([
                    dbRun("DELETE FROM users WHERE id=?", userId),
                    dbRun("DELETE FROM classusers WHERE studentId=?", userId),
                    dbRun("DELETE FROM shared_polls WHERE userId=?", userId),
                ]);
                await deleteCustomPolls(userId);
                await deleteClassrooms(userId);

                const student = classStateStore.getUser(user.email);
                if (student) {
                    const activeClass = classStateStore.getUser(user.email).activeClass;
                    const classroom = classStateStore.getClassroom(activeClass);
                    classStateStore.removeUser(user.email);
                    if (classroom) {
                        delete classroom.students[user.email];
                        userUpdateSocket(user.email, "classUpdate");
                    }
                }
                await dbRun("COMMIT");
            }
            await managerUpdate();
            return true;
        } catch (err) {
            await dbRun("ROLLBACK");
            throw err;
        }
    } catch (err) {
        return "There was an internal server error. Please try again.";
    }
}

module.exports = {
    getUserDataFromDb,
    requestPasswordReset,
    requestVerificationEmail,
    verifyEmailFromCode,
    resetPassword,
    regenerateAPIKey,
    requestPinReset,
    resetPin,
    updatePin,
    verifyPin,
    getUser,
    getUserOwnedClasses,
    getUserClass,
    logout,
    deleteUser,
};
