/**
 * SocketStateStore
 * Central in-memory store for socket-related runtime state.
 */
class SocketStateStore {
    constructor() {
        this._state = {
            runningTimers: {},
            rateLimits: {},
            userSockets: {},
            lastActivities: {},
        };
    }

    // -------------------------------------------------------------------------
    // Raw state access
    // -------------------------------------------------------------------------

    getRawState() {
        return this._state;
    }

    // -------------------------------------------------------------------------
    // Running timers
    // -------------------------------------------------------------------------

    getRunningTimers() {
        return this._state.runningTimers;
    }

    getRunningTimer(classId) {
        return this._state.runningTimers[classId];
    }

    setRunningTimer(classId, timerHandle) {
        this._state.runningTimers[classId] = timerHandle;
    }

    clearRunningTimer(classId, shouldClearInterval = true) {
        const timerHandle = this._state.runningTimers[classId];
        if (shouldClearInterval && timerHandle) {
            clearInterval(timerHandle);
        }
        this._state.runningTimers[classId] = null;
    }

    // -------------------------------------------------------------------------
    // Rate limits
    // -------------------------------------------------------------------------

    getRateLimits() {
        return this._state.rateLimits;
    }

    getUserRateLimits(email, create = false) {
        if (create && !this._state.rateLimits[email]) {
            this._state.rateLimits[email] = {};
        }
        return this._state.rateLimits[email];
    }

    clearUserRateLimits(email) {
        delete this._state.rateLimits[email];
    }

    // -------------------------------------------------------------------------
    // Connected sockets by email
    // -------------------------------------------------------------------------

    getUserSockets() {
        return this._state.userSockets;
    }

    getUserSocketsByEmail(email) {
        return this._state.userSockets[email];
    }

    setUserSocket(email, socketId, socket) {
        if (!this._state.userSockets[email]) {
            this._state.userSockets[email] = {};
        }
        this._state.userSockets[email][socketId] = socket;
    }

    removeUserSocket(email, socketId) {
        if (!this._state.userSockets[email]) {
            return { existed: false, emptyAfterRemoval: true };
        }

        const existed = !!this._state.userSockets[email][socketId];
        delete this._state.userSockets[email][socketId];

        const emptyAfterRemoval = Object.keys(this._state.userSockets[email]).length === 0;
        if (emptyAfterRemoval) {
            delete this._state.userSockets[email];
        }

        return { existed, emptyAfterRemoval };
    }

    hasUserSockets(email) {
        const sockets = this._state.userSockets[email];
        return !!(sockets && Object.keys(sockets).length > 0);
    }

    // -------------------------------------------------------------------------
    // Inactivity tracking
    // -------------------------------------------------------------------------

    getLastActivities() {
        return this._state.lastActivities;
    }

    getUserLastActivities(email) {
        return this._state.lastActivities[email];
    }

    touchLastActivity(email, socketId, socket, time = Date.now()) {
        if (!this._state.lastActivities[email]) {
            this._state.lastActivities[email] = {};
        }
        this._state.lastActivities[email][socketId] = { socket, time };
    }

    removeLastActivity(email, socketId) {
        if (!this._state.lastActivities[email]) return;

        delete this._state.lastActivities[email][socketId];
        if (Object.keys(this._state.lastActivities[email]).length === 0) {
            delete this._state.lastActivities[email];
        }
    }

    clearUserLastActivities(email) {
        delete this._state.lastActivities[email];
    }
}

const socketStateStore = new SocketStateStore();

module.exports = {
    SocketStateStore,
    socketStateStore,
};
