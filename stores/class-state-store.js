/**
 * ClassStateStore
 * An in-memory store for all active classroom and user session state.
 *
 * State shape:
 * {
 *   users: {
 *     [email: string]: Student
 *   },
 *   classrooms: {
 *     [classId: string|number]: Classroom
 *   }
 * }
 *
 * Each Classroom holds its own `students` map keyed by email.
 */
class ClassStateStore {
    constructor() {
        /** @type {{ users: Object.<string, Object>, classrooms: Object.<string|number, Object> }} */
        this._state = {
            users: {},
            classrooms: {},
        };
    }

    // -------------------------------------------------------------------------
    // Raw state access (for legacy compatibility with classInformation references)
    // -------------------------------------------------------------------------

    /**
     * Returns the raw state object.
     * Intended for legacy compatibility — prefer the typed getters/setters.
     * @returns {{ users: Object, classrooms: Object }}
     */
    getRawState() {
        return this._state;
    }

    // -------------------------------------------------------------------------
    // User methods
    // -------------------------------------------------------------------------

    /**
     * Returns the user with the given email, or undefined if not found.
     * @param {string} email
     * @returns {Object|undefined}
     */
    getUser(email) {
        return this._state.users[email];
    }

    /**
     * Sets (replaces) the user entry for the given email.
     * @param {string} email
     * @param {Object} user
     */
    setUser(email, user) {
        this._state.users[email] = user;
    }

    /**
     * Removes the user entry for the given email.
     * @param {string} email
     */
    removeUser(email) {
        delete this._state.users[email];
    }

    /**
     * Returns all users as a plain object keyed by email.
     * @returns {Object.<string, Object>}
     */
    getAllUsers() {
        return this._state.users;
    }

    /**
     * Updates a user by either shallow-merging a plain object or calling a
     * mutation function that receives the user and can mutate it in place.
     *
     * @param {string} email
     * @param {Object|Function} mutation - A plain object to merge, or a function (user) => void
     */
    updateUser(email, mutation) {
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

    /**
     * Returns the classroom with the given id, or undefined if not found.
     * @param {string|number} classId
     * @returns {Object|undefined}
     */
    getClassroom(classId) {
        return this._state.classrooms[classId];
    }

    /**
     * Sets (replaces) the classroom entry for the given id.
     * Also ensures the classroom has a `students` map.
     * @param {string|number} classId
     * @param {Object} classroom
     */
    setClassroom(classId, classroom) {
        if (!classroom.students) {
            classroom.students = {};
        }
        this._state.classrooms[classId] = classroom;
    }

    /**
     * Removes the classroom entry for the given id.
     * @param {string|number} classId
     */
    removeClassroom(classId) {
        delete this._state.classrooms[classId];
    }

    /**
     * Returns all classrooms as a plain object keyed by classId.
     * @returns {Object.<string|number, Object>}
     */
    getAllClassrooms() {
        return this._state.classrooms;
    }

    /**
     * Updates a classroom by either shallow-merging a plain object or calling a
     * mutation function that receives the classroom and can mutate it in place.
     *
     * @param {string|number} classId
     * @param {Object|Function} mutation - A plain object to merge, or a function (classroom) => void
     */
    updateClassroom(classId, mutation) {
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
    // Students are stored inside the classroom's `students` map, keyed by email.
    // -------------------------------------------------------------------------

    /**
     * Returns the student entry for the given email in the specified classroom,
     * or undefined if not found.
     * @param {string|number} classId
     * @param {string} email
     * @returns {Object|undefined}
     */
    getClassroomStudent(classId, email) {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return undefined;
        return classroom.students[email];
    }

    /**
     * Sets (replaces) the student entry for the given email in the specified classroom.
     * @param {string|number} classId
     * @param {string} email
     * @param {Object} student
     */
    setClassroomStudent(classId, email, student) {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return;
        classroom.students[email] = student;
    }

    /**
     * Removes the student entry for the given email from the specified classroom.
     * @param {string|number} classId
     * @param {string} email
     */
    removeClassroomStudent(classId, email) {
        const classroom = this._state.classrooms[classId];
        if (!classroom) return;
        delete classroom.students[email];
    }

    /**
     * Updates a classroom student by either shallow-merging a plain object or
     * calling a mutation function that receives the student and can mutate it in place.
     *
     * @param {string|number} classId
     * @param {string} email
     * @param {Object|Function} mutation - A plain object to merge, or a function (student) => void
     */
    updateClassroomStudent(classId, email, mutation) {
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
