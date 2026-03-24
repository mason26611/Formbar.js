import { PollRuntimeShape } from "../types/stores";

/**
 * PollRuntimeStore
 * Tracks runtime-only poll state that should not be persisted.
 */
class PollRuntimeStore {
    private _state: PollRuntimeShape;

    constructor() {
        this._state = {
            pogMeterIncreasedByClass: {},
            pollStartTimes: {},
            lastSavedPollIds: {},
        };
    }

    // -------------------------------------------------------------------------
    // Pog meter tracking
    // -------------------------------------------------------------------------

    resetPogMeterTracker(classId: number): void {
        this._state.pogMeterIncreasedByClass[classId] = {};
    }

    clearPogMeterTracker(classId: number): void {
        delete this._state.pogMeterIncreasedByClass[classId];
    }

    hasPogMeterIncreased(classId: number, email: string): boolean {
        return !!this._state.pogMeterIncreasedByClass[classId]?.[email];
    }

    markPogMeterIncreased(classId: number, email: string): void {
        if (!this._state.pogMeterIncreasedByClass[classId]) {
            this._state.pogMeterIncreasedByClass[classId] = {};
        }
        this._state.pogMeterIncreasedByClass[classId][email] = true;
    }

    getRawPogMeterIncreasedByClass(): Record<string | number, Record<string, boolean>> {
        return this._state.pogMeterIncreasedByClass;
    }

    // -------------------------------------------------------------------------
    // Poll start time tracking
    // -------------------------------------------------------------------------

    setPollStartTime(classId: number, timestamp: number): void {
        this._state.pollStartTimes[classId] = timestamp;
    }

    getPollStartTime(classId: number): number | null {
        return this._state.pollStartTimes[classId] ?? null;
    }

    clearPollStartTime(classId: number): void {
        delete this._state.pollStartTimes[classId];
    }

    // -------------------------------------------------------------------------
    // Last saved poll ID tracking
    // -------------------------------------------------------------------------

    setLastSavedPollId(classId: number, pollId: number): void {
        this._state.lastSavedPollIds[classId] = pollId;
    }

    getLastSavedPollId(classId: number): number | null {
        return this._state.lastSavedPollIds[classId] ?? null;
    }

    clearLastSavedPollId(classId: number): void {
        delete this._state.lastSavedPollIds[classId];
    }
}

const pollRuntimeStore = new PollRuntimeStore();

module.exports = {
    PollRuntimeStore,
    pollRuntimeStore,
};
