import type { UserState } from "../types/stores";
import type { ClassUserRow, UserRow } from "../types/database";

const { classStateStore } = require("@services/classroom-service") as {
    classStateStore: {
        getUser: (email: string) => UserState | undefined;
        getAllUsers: () => Record<string, UserState>;
    };
};
const { database, dbGet } = require("@modules/database") as {
    database: {
        all: <T>(sql: string, params: unknown[], cb: (err: Error | null, rows: T[]) => void) => void;
        get: <T>(sql: string, params: unknown[], cb: (err: Error | null, row: T | undefined) => void) => void;
    };
    dbGet: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
};
const { STUDENT_PERMISSIONS } = require("@modules/permissions") as { STUDENT_PERMISSIONS: number };

// Interfaces

interface PollResponse {
    buttonRes: string | string[];
    textRes: string;
    time: Date | string | null;
}

interface StudentOptions {
    isGuest?: boolean;
}

interface UserData {
    email: string;
    id: number;
    permissions?: number;
    API?: string;
    ownedPolls?: unknown[] | string;
    sharedPolls?: unknown[] | string;
    tags?: string | string[] | null;
    displayName?: string | null;
    isGuest?: boolean;
    activeClass?: number | null;
    classPermissions?: number | null;
    role?: string | null;
    classRole?: string | null;
    pogMeter?: number;
    help?: boolean | { reason: string; time: number };
    break?: boolean | string;
    pollRes?: Partial<PollResponse>;
    verified?: number;
}

interface ClassUserPermission {
    id: number;
    permissions: number | null;
    classRole: string | null;
}

class Student {
    email: string;
    id: number;
    activeClass: number | null;
    permissions: number;
    classPermissions: number | null;
    role: string | null;
    classRole: string | null;
    tags: string[];
    ownedPolls: unknown[];
    sharedPolls: unknown[];
    pollRes: PollResponse;
    help: boolean | { reason: string; time: number };
    break: boolean | string;
    API: string;
    pogMeter: number;
    displayName: string | null;
    isGuest: boolean;
    verified?: number;

    constructor(
        email: string,
        id: number,
        permissions: number = STUDENT_PERMISSIONS,
        API: string,
        ownedPolls: unknown[] = [],
        sharedPolls: unknown[] = [],
        tags: string[],
        displayName: string | null,
        isGuest: boolean = false,
    ) {
        this.email = email;
        this.id = id;
        this.activeClass = null;
        this.permissions = permissions;
        this.classPermissions = null;
        this.role = null;
        this.classRole = null;
        this.tags = tags || [];
        this.ownedPolls = ownedPolls || [];
        this.sharedPolls = sharedPolls || [];
        this.pollRes = {
            buttonRes: "",
            textRes: "",
            time: null,
        };
        this.help = false;
        this.break = false;
        this.API = API;
        this.pogMeter = 0;
        this.displayName = displayName;
        this.isGuest = isGuest;
    }
}

/**
 * Normalizes user tags into an array of strings.
 * Accepts either comma-delimited strings or arrays.
 */
function normalizeTags(tags: string | string[] | null | undefined): string[] {
    if (Array.isArray(tags)) {
        return tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter(Boolean);
    }

    if (typeof tags !== "string" || !tags.trim()) {
        return [];
    }

    return tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}

/**
 * Safely parses arrays that may be persisted as JSON strings.
 */
function parseArrayField(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Builds a standardized in-memory Student/session user object from a DB row
 * or existing user-like object.
 */
function createStudentFromUserData(userData: UserData, options: StudentOptions = {}): Student {
    const isGuest = options.isGuest != null ? options.isGuest : Boolean(userData?.isGuest);

    const student = new Student(
        userData.email,
        userData.id,
        userData.permissions,
        userData.API as string,
        parseArrayField(userData.ownedPolls),
        parseArrayField(userData.sharedPolls),
        normalizeTags(userData.tags),
        userData.displayName ?? null,
        isGuest,
    );

    if (userData.activeClass != null) {
        student.activeClass = userData.activeClass;
    }

    if (userData.classPermissions != null) {
        student.classPermissions = userData.classPermissions;
    }

    if (userData.role != null) {
        student.role = userData.role;
    }

    if (userData.classRole != null) {
        student.classRole = userData.classRole;
    }

    if (userData.pogMeter != null) {
        student.pogMeter = userData.pogMeter;
    }

    if (userData.help !== undefined) {
        student.help = userData.help;
    }

    if (userData.break !== undefined) {
        student.break = userData.break;
    }

    if (userData.pollRes && typeof userData.pollRes === "object") {
        student.pollRes = { ...student.pollRes, ...userData.pollRes };
    }

    if (Object.prototype.hasOwnProperty.call(userData, "verified")) {
        student.verified = userData.verified;
    }

    return student;
}

/**
 * Retrieves the students in a class from the database.
 * Creates an actual student class for each student rather than just returning their data.
 */
async function getStudentsInClass(classId: number): Promise<Record<string, Student>> {
    // Grab students associated with the class
    const studentIdsAndPermissions: ClassUserPermission[] = await new Promise((resolve, reject) => {
        database.all(
            "SELECT * FROM classusers WHERE classId = ?",
            [classId],
            (err: Error | null, rows: ClassUserRow[]) => {
                if (err) {
                    return reject(err);
                }

                const mapped: ClassUserPermission[] = rows.map((row) => ({
                    id: row.studentId,
                    permissions: row.permissions,
                    classRole: row.role || null,
                }));

                resolve(mapped);
            },
        );
    });

    // Get student ids in the class user data
    const studentIds = studentIdsAndPermissions.map((student) => student.id);
    const studentsData: Record<string, UserRow> = await new Promise((resolve, reject) => {
        database.all(
            "SELECT * FROM users WHERE id IN (" + studentIds.map(() => "?").join(",") + ")",
            studentIds,
            (err: Error | null, rows: UserRow[]) => {
                if (err) {
                    return reject(err);
                }

                const studentData: Record<string, UserRow> = {};
                for (const row of rows) {
                    studentData[row.email] = row;
                }

                resolve(studentData);
            },
        );
    });

    // Create student class and return the data
    const students: Record<string, Student> = {};
    for (const email in studentsData) {
        const userData = studentsData[email];
        const classUserRow = studentIdsAndPermissions.find((student) => student.id === userData.id);
        const student = createStudentFromUserData(userData as unknown as UserData, { isGuest: false });
        student.classPermissions = classUserRow?.permissions ?? null;
        student.classRole = classUserRow?.classRole ?? null;
        students[email] = student;
    }

    return students;
}

/**
 * Retrieves a student's id from their email.
 */
function getIdFromEmail(email: string): number | Promise<number> | undefined {
    try {
        // If the user is already loaded, return the id
        const user: UserState | undefined = classStateStore.getUser(email);
        if (user) {
            return user.id;
        }

        // If the user isn't loaded, get the id from the database
        return new Promise<number>((resolve, reject) => {
            database.get(
                "SELECT id FROM users WHERE email=?",
                [email],
                (err: Error | null, row: Pick<UserRow, "id"> | undefined) => {
                    if (err) return reject(err);
                    resolve(row!.id);
                },
            );
        });
    } catch {
        // Error handled by caller
    }
}

async function getEmailFromId(userId: number): Promise<string | null> {
    let email: string | null = null;
    const allUsers: Record<string, UserState> = classStateStore.getAllUsers();
    for (const user of Object.values(allUsers)) {
        if (user.id === userId) {
            email = user.email;
            break;
        }
    }

    // If the user is not logged in, then get their email from the database
    if (!email) {
        const emailData = await dbGet<Pick<UserRow, "email">>("SELECT email FROM users WHERE id = ?", [userId]);
        if (emailData && emailData.email) {
            email = emailData.email;
        }
    }

    return email;
}

module.exports = {
    Student,
    createStudentFromUserData,
    getStudentsInClass,
    getIdFromEmail,
    getEmailFromId,
};
