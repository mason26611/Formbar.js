import type { Socket } from "socket.io";
import type { UserRow, ClassroomRow, TempUserCreationDataRow } from "../types/database";
import type { UserState, ClassroomState, ClassStudent } from "../types/stores";
import type { AppErrorOptions } from "../errors/app-error";

const handlebars = require("handlebars") as typeof import("handlebars");
const fs = require("fs") as typeof import("fs");
const bcrypt = require("bcrypt") as typeof import("bcrypt");
const crypto = require("crypto") as typeof import("crypto");

const AppError = require("@errors/app-error") as new (
    message: string,
    options?: AppErrorOptions
) => InstanceType<typeof import("../errors/app-error").AppError>;

const NotFoundError = require("@errors/not-found-error") as new (
    message: string,
    options?: AppErrorOptions
) => Error & { statusCode: number; isOperational: boolean; event?: string; reason?: string };

const { sendMail } = require("@modules/mail") as {
    sendMail: (recipient: string, subject: string, html: string) => void;
};

const { dbGetAll: _dbGetAll, dbGet: _dbGet, dbRun: _dbRun, database } = require("@modules/database") as {
    dbGetAll: <T>(query: string, params?: unknown[]) => Promise<T[]>;
    dbGet: <T>(query: string, params?: unknown[]) => Promise<T | undefined>;
    dbRun: (query: string, params?: unknown[]) => Promise<number>;
    database: {
        all: <T>(sql: string, params: unknown[], cb: (err: Error | null, rows: T[]) => void) => void;
        get: <T>(sql: string, params: unknown[], cb: (err: Error | null, row: T | undefined) => void) => void;
    };
};

const { frontendUrl } = require("@modules/config") as { frontendUrl: string };

const { classStateStore } = require("@services/classroom-service") as {
    classStateStore: {
        getUser: (email: string) => UserState | undefined;
        getAllClassrooms: () => Record<string | number, ClassroomState>;
        getClassroom: (classId: string | number | null | undefined) => ClassroomState | undefined;
        updateUser: (email: string, data: Partial<UserState>) => void;
        removeUser: (email: string) => void;
    };
};

const { apiKeyCacheStore } = require("@stores/api-key-cache-store") as {
    apiKeyCacheStore: {
        get: (apiKey: string) => string | undefined;
        set: (apiKey: string, email: string) => void;
        invalidateByEmail: (email: string) => void;
        clear: () => void;
    };
};

const { socketStateStore } = require("@stores/socket-state-store") as {
    socketStateStore: {
        removeUserSocket: (email: string, socketId: string) => { existed: boolean; emptyAfterRemoval: boolean };
        removeLastActivity: (email: string, socketId: string) => void;
        getUserSocketsByEmail: (email: string) => Record<string, Socket> | undefined;
    };
};

const { GUEST_PERMISSIONS } = require("@modules/permissions") as { GUEST_PERMISSIONS: number };

const { handleSocketError } = require("@modules/socket-error-handler") as {
    handleSocketError: (err: Error | string, socket: SocketWithSession, event: string, customMessage?: string) => Promise<void>;
};

const { managerUpdate, userUpdateSocket } = require("@services/socket-updates-service") as {
    managerUpdate: () => Promise<void>;
    userUpdateSocket: (email: string, methodName: string, ...args: unknown[]) => void;
};

const { endClass } = require("@services/class-service") as {
    endClass: (classId: number) => void;
};

const { deleteRooms } = require("@services/class-service") as {
    deleteRooms: (userId: number) => Promise<void>;
};

const { deleteCustomPolls } = require("@services/poll-service") as {
    deleteCustomPolls: (userId: number) => Promise<void>;
};

const { hash } = require("@modules/crypto") as {
    hash: (text: string) => Promise<string>;
};

const { requireInternalParam } = require("@modules/error-wrapper") as {
    requireInternalParam: (param: unknown, name: string) => void;
};

const { getEmailFromId } = require("@services/student-service") as {
    getEmailFromId: (userId: number) => Promise<string | null>;
};

// --- Generic typed database wrappers ---

const dbGet = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T | undefined> => _dbGet(query, params);
const dbGetAll = <T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> => _dbGetAll(query, params);
const dbRun = (query: string, params?: unknown[]): Promise<number> => _dbRun(query, params);

// --- Interfaces ---

interface SocketWithSession extends Socket {
    request: Socket["request"] & {
        session: {
            email: string;
            userId: number;
            classId: number | null;
            destroy: (cb: (err: Error | null) => void) => void;
            [key: string]: unknown;
        };
    };
}

interface UserIdentifier {
    email?: string;
    api?: string;
}

interface GetUserResult {
    loggedIn: boolean;
    id: number;
    email: string;
    permissions: number;
    classPermissions: number | null;
    help: boolean | { reason: string; time: number } | null;
    break: boolean | string | null;
    pogMeter: number;
    classId: number | null;
}

interface GetUserError {
    error: string;
}

interface GetEmailFromAPIKeyError {
    error: string;
}

// --- Template caching ---

let passwordResetTemplate: Handlebars.TemplateDelegate<{ resetUrl: string }> | null = null;
let verifyEmailTemplate: Handlebars.TemplateDelegate<{ verifyUrl: string }> | null = null;
let pinResetTemplate: Handlebars.TemplateDelegate<{ resetUrl: string }> | null = null;

function loadPasswordResetTemplate(): Handlebars.TemplateDelegate<{ resetUrl: string }> {
    if (passwordResetTemplate) return passwordResetTemplate;
    try {
        const resetEmailContent = fs.readFileSync("email-templates/password-reset.hbs", "utf8");
        passwordResetTemplate = handlebars.compile<{ resetUrl: string }>(resetEmailContent);
        return passwordResetTemplate;
    } catch (err) {
        console.error("Failed to load password reset email template:", err);
        throw new AppError("Failed to load password reset email template.", { statusCode: 500, event: "user.password.reset.failed", reason: "template_load_error" });
    }
}

function loadPinResetTemplate(): Handlebars.TemplateDelegate<{ resetUrl: string }> {
    if (pinResetTemplate) return pinResetTemplate;
    try {
        const pinResetEmailContent = fs.readFileSync("email-templates/pin-reset.hbs", "utf8");
        pinResetTemplate = handlebars.compile<{ resetUrl: string }>(pinResetEmailContent);
        return pinResetTemplate;
    } catch (err) {
        console.error("Failed to load PIN reset email template:", err);
        throw new AppError("Failed to load PIN reset email template.", { statusCode: 500, event: "user.pin.reset.failed", reason: "template_load_error" });
    }
}

function loadVerifyEmailTemplate(): Handlebars.TemplateDelegate<{ verifyUrl: string }> {
    if (verifyEmailTemplate) return verifyEmailTemplate;
    try {
        const verifyEmailContent = fs.readFileSync("email-templates/verify-email.hbs", "utf8");
        verifyEmailTemplate = handlebars.compile<{ verifyUrl: string }>(verifyEmailContent);
        return verifyEmailTemplate;
    } catch (err) {
        console.error("Failed to load verification email template:", err);
        throw new AppError("Failed to load verification email template.", { statusCode: 500, event: "user.verify.email.failed", reason: "template_load_error" });
    }
}

// --- Core functions ---

async function getUserDataFromDb(userId: number): Promise<UserRow | undefined> {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
    return user;
}

async function requestPasswordReset(email: string): Promise<void> {
    const template = loadPasswordResetTemplate();
    const secret = crypto.randomBytes(256).toString("hex");
    await dbRun("UPDATE users SET secret = ? WHERE email = ?", [secret, email]);
    sendMail(email, "Formbar Password Change", template({ resetUrl: `${frontendUrl}/user/me/password?code=${secret}` }));
}

async function requestPinReset(userId: number): Promise<void> {
    requireInternalParam(userId, "userId");
    const user = await getUserDataFromDb(userId);
    if (!user) throw new NotFoundError("User not found.", { event: "user.pin.reset.request.failed", reason: "user_not_found" });
    const template = loadPinResetTemplate();
    const token = crypto.randomBytes(64).toString("hex");
    await dbRun("UPDATE users SET secret = ? WHERE id = ?", [token, userId]);
    sendMail(user.email, "Formbar PIN Reset", template({ resetUrl: `${frontendUrl}/user/me/pin?code=${token}` }));
}

async function resetPin(newPin: string | number, token: string): Promise<void> {
    requireInternalParam(newPin, "newPin");
    requireInternalParam(token, "token");
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE secret = ?", [token]);
    if (!user) throw new NotFoundError("PIN reset token is invalid or has expired.", { event: "user.pin.reset.failed", reason: "invalid_token" });
    const hashedPin = await hash(String(newPin));
    await dbRun("UPDATE users SET pin = ? WHERE id = ?", [hashedPin, user.id]);
}

async function updatePin(userId: number, oldPin: string | number | undefined, newPin: string | number): Promise<void> {
    requireInternalParam(userId, "userId");
    requireInternalParam(newPin, "newPin");
    const user = await getUserDataFromDb(userId);
    if (!user) throw new NotFoundError("User not found.", { event: "user.pin.update.failed", reason: "user_not_found" });
    if (user.pin) {
        requireInternalParam(oldPin, "oldPin");
        const oldPinMatches = await bcrypt.compare(String(oldPin), user.pin);
        if (!oldPinMatches) {
            const AuthError = require("@errors/auth-error") as new (message: string, options?: AppErrorOptions) => Error;
            throw new AuthError("Current PIN is incorrect.", { event: "user.pin.update.failed", reason: "incorrect_old_pin" });
        }
    }
    const hashedPin = await hash(String(newPin));
    await dbRun("UPDATE users SET pin = ? WHERE id = ?", [hashedPin, userId]);
}

async function verifyPin(userId: number, pin: string | number): Promise<true> {
    requireInternalParam(userId, "userId");
    requireInternalParam(pin, "pin");
    const user = await getUserDataFromDb(userId);
    if (!user) throw new NotFoundError("User not found.", { event: "user.pin.verify.failed", reason: "user_not_found" });
    if (!user.pin) throw new AppError("No PIN is set for this account. Please create one first.", { statusCode: 400, event: "user.pin.verify.failed", reason: "pin_not_set" });
    const pinMatches = await bcrypt.compare(String(pin), user.pin);
    if (!pinMatches) {
        const AuthError = require("@errors/auth-error") as new (message: string, options?: AppErrorOptions) => Error;
        throw new AuthError("PIN is incorrect.", { event: "user.pin.verify.failed", reason: "incorrect_pin" });
    }
    return true;
}

async function requestVerificationEmail(userId: number, apiBaseUrl: string): Promise<{ alreadyVerified: boolean }> {
    requireInternalParam(userId, "userId");
    const user = await dbGet<Pick<UserRow, "id" | "email" | "verified">>("SELECT id, email, verified FROM users WHERE id = ?", [userId]);
    if (!user) throw new NotFoundError("User not found.", { event: "user.verify.email.failed", reason: "user_not_found" });
    if (user.verified) return { alreadyVerified: true };
    const template = loadVerifyEmailTemplate();
    const secret = crypto.randomBytes(256).toString("hex");
    const verifyUrl = frontendUrl ? `${frontendUrl}/user/verify/email?code=${secret}` : `${apiBaseUrl}/api/v1/user/verify/email?code=${secret}`;
    await dbRun("UPDATE users SET secret = ? WHERE id = ?", [secret, user.id]);
    sendMail(user.email, "Formbar Email Verification", template({ verifyUrl }));
    return { alreadyVerified: false };
}

async function verifyEmailFromCode(code: string): Promise<{ userId: number; alreadyVerified: boolean }> {
    requireInternalParam(code, "code");
    const user = await dbGet<Pick<UserRow, "id" | "email" | "verified">>("SELECT id, email, verified FROM users WHERE secret = ?", [code]);
    if (!user) throw new NotFoundError("Verification token is invalid or has expired.", { event: "user.verify.email.failed", reason: "invalid_code" });
    if (!user.verified) {
        await dbRun("UPDATE users SET verified = 1 WHERE id = ?", [user.id]);
        if (classStateStore.getUser(user.email)) {
            classStateStore.updateUser(user.email, { verified: 1 });
        }
    }
    return { userId: user.id, alreadyVerified: Boolean(user.verified) };
}

async function resetPassword(password: string, token: string): Promise<true> {
    requireInternalParam(password, "password");
    requireInternalParam(token, "token");
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE secret = ?", [token]);
    if (!user) throw new NotFoundError("Password reset token is invalid or has expired.", { event: "user.password.reset.failed", reason: "invalid_token" });
    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, user.id]);
    return true;
}

async function regenerateAPIKey(userId: number): Promise<string> {
    requireInternalParam(userId, "userId");
    const user = await getUserDataFromDb(userId);
    if (!user) throw new NotFoundError("User not found for API key regeneration.", { event: "user.api_key.regenerate.failed", reason: "user_not_found" });
    const apiKey = crypto.randomBytes(32).toString("hex");
    const hashedAPIKey = await hash(apiKey);
    await dbRun("UPDATE users SET API = ? WHERE id = ?", [hashedAPIKey, userId]);
    const email = await getEmailFromId(userId);
    if (email) { apiKeyCacheStore.invalidateByEmail(email); } else { apiKeyCacheStore.clear(); }
    return apiKey;
}

function getUserClass(email: string): number | null | Error {
    try {
        const allClassrooms = classStateStore.getAllClassrooms();
        for (const classroomId in allClassrooms) {
            const classroom = allClassrooms[classroomId];
            if (classroom.students[email]) return classroom.id;
        }
        return null;
    } catch (err) { return err as Error; }
}

async function getEmailFromAPIKey(api: string): Promise<string | GetEmailFromAPIKeyError | Error> {
    try {
        if (!api) return { error: "Missing API key" };
        const cachedEmail = apiKeyCacheStore.get(api);
        if (cachedEmail) return cachedEmail;
        const user = await new Promise<UserRow | GetEmailFromAPIKeyError>((resolve, reject) => {
            database.all<UserRow>("SELECT * FROM users", [], async (err: Error | null, users: UserRow[]) => {
                try {
                    if (err) throw err;
                    let userData: UserRow | null = null;
                    for (const user of users) {
                        if (user.API && (await bcrypt.compare(api, user.API))) { userData = user; break; }
                    }
                    if (!userData) { resolve({ error: "Not a valid API key" }); return; }
                    resolve(userData);
                } catch (innerErr) { reject(innerErr); }
            });
        });
        if ("error" in user) return user;
        apiKeyCacheStore.set(api, user.email);
        return user.email;
    } catch (err) { return err as Error; }
}

interface DbUserWithClassPermissions {
    id: number;
    email: string;
    permissions: number;
    classPermissions: number | null;
}

async function getUser(userIdentifier: UserIdentifier): Promise<GetUserResult | GetUserError | Error> {
    try {
        const email = userIdentifier.email || (await getEmailFromAPIKey(userIdentifier.api!));
        if (email instanceof Error) throw email;
        if (typeof email === "object" && "error" in email) throw email;
        let classId = getUserClass(email as string);
        if (classId instanceof Error) throw classId;

        const dbUser = await new Promise<DbUserWithClassPermissions | GetUserError>((resolve, reject) => {
            if (!classId) {
                database.get<DbUserWithClassPermissions>(
                    "SELECT id, email, permissions, NULL AS classPermissions FROM users WHERE email = ?",
                    [email],
                    (err: Error | null, row: DbUserWithClassPermissions | undefined) => {
                        try {
                            if (err) throw err;
                            if (!row) { resolve({ error: "user does not exist" }); return; }
                            resolve(row);
                        } catch (innerErr) { reject(innerErr); }
                    }
                );
                return;
            }
            database.get<DbUserWithClassPermissions>(
                "SELECT users.id, users.email, users.permissions, CASE WHEN users.id = classroom.owner THEN 5 ELSE classusers.permissions END AS classPermissions FROM users JOIN classroom ON classroom.id = ? LEFT JOIN classusers ON classusers.classId = classroom.id AND classusers.studentId = users.id WHERE users.email = ?;",
                [classId, email],
                (err: Error | null, row: DbUserWithClassPermissions | undefined) => {
                    try {
                        if (err) throw err;
                        if (!row) { resolve({ error: "user does not exist in this class" }); return; }
                        resolve(row);
                    } catch (innerErr) { reject(innerErr); }
                }
            );
        });

        if ("error" in dbUser) return dbUser;

        const userData: GetUserResult = {
            loggedIn: false,
            ...dbUser,
            help: null,
            break: null,
            pogMeter: 0,
            classId: classId as number | null,
        };

        const classroom = classStateStore.getClassroom(classId);
        if (classroom && classroom.students[dbUser.email]) {
            const cdUser = classroom.students[dbUser.email];
            if (cdUser) {
                userData.loggedIn = true;
                userData.help = cdUser.help ?? null;
                userData.break = cdUser.break ?? null;
                userData.pogMeter = (cdUser as ClassStudent & { pogMeter?: number }).pogMeter ?? 0;
            }
        }
        return userData;
    } catch (err) { return err as Error; }
}

async function getUserOwnedClasses(email: string): Promise<ClassroomRow[]> {
    const user = await dbGet<Pick<UserRow, "id">>("SELECT id FROM users WHERE email = ?", [email]);
    return dbGetAll<ClassroomRow>("SELECT * FROM classroom WHERE owner=?", [user!.id]);
}

function logout(socket: SocketWithSession): void {
    const email = socket.request.session.email;
    const userId = socket.request.session.userId;
    const classId = socket.request.session.classId;
    let isLastSession = false;
    const { emptyAfterRemoval } = socketStateStore.removeUserSocket(email, socket.id);
    isLastSession = emptyAfterRemoval;
    if (classId) socket.leave(`class-${classId}`);
    socket.request.session.destroy((err: Error | null) => {
        try {
            if (err) throw err;
            socket.emit("reload");
            socketStateStore.removeLastActivity(email, socket.id);
            if (isLastSession) {
                const user = classStateStore.getUser(email);
                if (user) { user.activeClass = undefined; user.break = false; user.help = false; user.classPermissions = undefined; }
                if (user && user.permissions === GUEST_PERMISSIONS) { classStateStore.removeUser(email); }
                if (!classId) return;
                const classroom = classStateStore.getClassroom(classId);
                if (classroom) {
                    const student = classroom.students[email];
                    if (student) {
                        if ((student as ClassStudent & { isGuest?: boolean }).isGuest) { delete classroom.students[email]; }
                        else {
                            student.break = false;
                            student.help = false;
                            // Tags can be a parsed string[] at runtime despite the string | null type
                            const mutableStudent = student as ClassStudent & { activeClass?: number | null; tags: string | string[] | null; [k: string]: unknown };
                            mutableStudent.activeClass = null;
                            if (Array.isArray(mutableStudent.tags) && !mutableStudent.tags.includes("Offline")) { mutableStudent.tags.push("Offline"); }
                            else if (!mutableStudent.tags) { (mutableStudent as Record<string, unknown>).tags = ["Offline"]; }
                        }
                    }
                    userUpdateSocket(email, "classUpdate", classId);
                }
                database.get<ClassroomRow>("SELECT * FROM classroom WHERE owner=? AND id=?", [userId, classId], (dbErr: Error | null, dbClassroom: ClassroomRow | undefined) => {
                    if (dbErr) { handleSocketError(dbErr, socket, "logout:database"); }
                    if (dbClassroom) { endClass(dbClassroom.id); }
                });
            }
        } catch (catchErr) { handleSocketError(catchErr as Error, socket, "logout"); }
    });
}

async function deleteUser(userId: number, _userSession?: unknown): Promise<true | string> {
    try {
        const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [userId]);
        let tempUser: TempUserCreationDataRow | undefined;
        if (!user) {
            tempUser = await dbGet<TempUserCreationDataRow>("SELECT * FROM temp_user_creation_data WHERE secret=?", [userId]);
            if (!tempUser) return "User not found";
            await dbRun("DELETE FROM temp_user_creation_data WHERE secret=?", [userId]);
        }
        const userSocketsMap = socketStateStore.getUserSocketsByEmail(user ? user.email : tempUser!.token);
        if (userSocketsMap) {
            const anySocket = Object.values(userSocketsMap)[0] as SocketWithSession | undefined;
            if (anySocket) logout(anySocket);
        }
        try {
            if (user) {
                await dbRun("BEGIN TRANSACTION");
                await Promise.all([
                    dbRun("DELETE FROM users WHERE id=?", [userId]),
                    dbRun("DELETE FROM classusers WHERE studentId=?", [userId]),
                    dbRun("DELETE FROM shared_polls WHERE userId=?", [userId]),
                ]);
                await deleteCustomPolls(userId);
                await deleteRooms(userId);
                const student = classStateStore.getUser(user.email);
                if (student) {
                    const activeClass = classStateStore.getUser(user.email)!.activeClass;
                    const classroom = classStateStore.getClassroom(activeClass);
                    classStateStore.removeUser(user.email);
                    if (classroom) { delete classroom.students[user.email]; userUpdateSocket(user.email, "classUpdate"); }
                }
                await dbRun("COMMIT");
            }
            await managerUpdate();
            return true;
        } catch (err) { await dbRun("ROLLBACK"); throw err; }
    } catch (_err) { return "There was an internal server error. Please try again."; }
}

module.exports = {
    getUserDataFromDb, requestPasswordReset, requestVerificationEmail, verifyEmailFromCode,
    resetPassword, regenerateAPIKey, requestPinReset, resetPin, updatePin, verifyPin,
    getUser, getUserOwnedClasses, getUserClass, logout, deleteUser,
};
