/**
 * PollRuntimeStore
 * Tracks runtime-only poll state that should not be persisted.
 */
class PollRuntimeStore {
    constructor() {
        this._state = {
            // classId -> { [email]: true }
            pogMeterIncreasedByClass: {},
            // classId -> timestamp (ms since epoch)
            pollStartTimes: {},
            // classId -> pollId (number) | null
            lastSavedPollIds: {},
        };
    }

    // -------------------------------------------------------------------------
    // Pog meter tracking
    // -------------------------------------------------------------------------
    /**
     * Resets the pog meter tracker for a class.
     * @param {number} classId - The class identifier.
     * @returns {void}
     */
    resetPogMeterTracker(classId) {
        this._state.pogMeterIncreasedByClass[classId] = {};
    }

    /**
     * Clears the pog meter tracker entry for a class.
     * @param {number} classId - The class identifier.
     * @returns {void}
     */
    clearPogMeterTracker(classId) {
        delete this._state.pogMeterIncreasedByClass[classId];
    }

    /**
     * Returns whether a given user has increased the pog meter in a class.
     * @param {number} classId - The class identifier.
     * @param {string} email - The user's email address.
     * @returns {boolean} True if the user has increased the pog meter.
     */
    hasPogMeterIncreased(classId, email) {
        return !!this._state.pogMeterIncreasedByClass[classId]?.[email];
    }

    /**
     * Marks that a given user has increased the pog meter for a class.
     * @param {number} classId - The class identifier.
     * @param {string} email - The user's email address.
     * @returns {void}
     */
    markPogMeterIncreased(classId, email) {
        if (!this._state.pogMeterIncreasedByClass[classId]) {
            this._state.pogMeterIncreasedByClass[classId] = {};
        }
        this._state.pogMeterIncreasedByClass[classId][email] = true;
    }

    /**
     * Returns the raw pog meter increased tracking object.
     * Structure: { [classId]: { [email]: true } }
     * @returns {Object<string, Object<string,boolean>>}
     */
    getRawPogMeterIncreasedByClass() {
        return this._state.pogMeterIncreasedByClass;
    }

    // -------------------------------------------------------------------------
    // Poll start time tracking
    // -------------------------------------------------------------------------

    /**
     * Records the timestamp when the active poll was started.
     * @param {number} classId
     * @param {number} timestamp - ms since epoch (e.g. Date.now())
     */
    setPollStartTime(classId, timestamp) {
        this._state.pollStartTimes[classId] = timestamp;
    }

    /**
     * Returns the start timestamp for the active poll in a class, or null if unset.
     * @param {number} classId
     * @returns {number|null}
     */
    getPollStartTime(classId) {
        return this._state.pollStartTimes[classId] ?? null;
    }

    /**
     * Removes the start time entry for a class (called when the class ends or poll is cleared).
     * @param {number} classId
     */
    clearPollStartTime(classId) {
        delete this._state.pollStartTimes[classId];
    }

    // -------------------------------------------------------------------------
    // Last saved poll ID tracking
    // -------------------------------------------------------------------------

    /**
     * Records the database poll_history ID of the most recently auto-saved poll for a class.
     * Used by clearPoll to know which record to attach poll_answers rows to.
     * @param {number} classId
     * @param {number|null} pollId
     */
    setLastSavedPollId(classId, pollId) {
        this._state.lastSavedPollIds[classId] = pollId;
    }

    /**
     * Returns the last saved poll_history ID for a class, or null if none.
     * @param {number} classId
     * @returns {number|null}
     */
    getLastSavedPollId(classId) {
        return this._state.lastSavedPollIds[classId] ?? null;
    }

    /**
     * Clears the last saved poll ID for a class (called when the poll is fully cleared).
     * @param {number} classId
     */
    clearLastSavedPollId(classId) {
        delete this._state.lastSavedPollIds[classId];
    }
}

const pollRuntimeStore = new PollRuntimeStore();

module.exports = {
    PollRuntimeStore,
    pollRuntimeStore,
};
