import {
    ClassStateShape,
    ClassroomState,
    UserState,
    ClassStudent,
} from "../types/stores";

/**
 * ClassStateStore
 * An in-memory store for all active classroom and user session state.
 */
class ClassStateStore {
    private _state: ClassStateShape;

    constructor() {
        this._state = {
            users: {},
            classrooms: {},
        };
    }

    // -------------------------------------------------------------------------
    // Raw state access (for legacy compatibility with classInformation references)
    // -------------------------------------------------------------------------

    getRawState(): ClassStateShape {
        return this._state;
    }

    // -------------------------------------------------------------------------
    // User methods
    // -------------------------------------------------------------------------

    getUser(email: string): UserState | undefined {
        return this._state.users[email];
    }

    setUser(email: string, user: UserState): void {
        this._state.users[email] = user;
    }

    removeUser(email: string): void {
        delete this._state.users[email];
    }

    getAllUsers(): Record<string, UserState> {
        return this._state.users;
    }

    updateUser(email: string, mutation: Partial<UserState> | ((user: UserState) => void)): void {
        const user = this._state.users[email];
        if (!user) return;

        if (typeof mutation === "function") {
            mutation(user);
        } else {
            Object.assign(user, mutation);
        }
    }

    // -------------------------------------------------------------------------
    // Classroom methods
    // -------------------------------------------------------------------------

    getClassroom(classId: string | number): ClassroomState | undefined {
        return this._state.classrooms[classId];
    }

    setClassroom(classId: string | number, classroom: ClassroomState): void {
        if (!classroom.students) {
            classroom.students = {};
        }
        this._state.classrooms[classId] = classroom;
    }

    removeClassroom(classId: string | number): void {
        delete this._state.classrooms[classId];
    }

    getAllClassrooms(): Record<string | number, ClassroomState> {
        return this._state.classrooms;
    }

    updateClassroom(
        classId: string | number,
        mutation: Partial<ClassroomState> | ((classroom: ClassroomState) => void),
    ): void {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return;

        if (typeof mutation === "function") {
            mutation(classroom);
        } else {
            Object.assign(classroom, mutation);
        }
    }

    // -------------------------------------------------------------------------
    // Classroom student methods
    // -------------------------------------------------------------------------

    getClassroomStudent(classId: string | number, email: string): ClassStudent | undefined {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return undefined;
        return classroom.students[email];
    }

    setClassroomStudent(classId: string | number, email: string, student: ClassStudent): void {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return;
        classroom.students[email] = student;
    }

    removeClassroomStudent(classId: string | number, email: string): void {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return;
        delete classroom.students[email];
    }

    updateClassroomStudent(
        classId: string | number,
        email: string,
        mutation: Partial<ClassStudent> | ((student: ClassStudent) => void),
    ): void {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return;

        const student = classroom.students[email];
        if (!student) return;

        if (typeof mutation === "function") {
            mutation(student);
        } else {
            Object.assign(student, mutation);
        }
    }
}

module.exports = {
    ClassStateStore,
};
