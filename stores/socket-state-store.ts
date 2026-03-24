import { Socket } from "socket.io";
import { SocketStateShape, SocketActivity } from "../types/stores";

interface SocketRemovalResult {
    existed: boolean;
    emptyAfterRemoval: boolean;
}

/**
 * SocketStateStore
 * Central in-memory store for socket-related runtime state.
 */
class SocketStateStore {
    private _state: SocketStateShape;

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

    getRawState(): SocketStateShape {
        return this._state;
    }

    // -------------------------------------------------------------------------
    // Running timers
    // -------------------------------------------------------------------------

    getRunningTimers(): Record<string | number, ReturnType<typeof setInterval> | null> {
        return this._state.runningTimers;
    }

    getRunningTimer(classId: string | number): ReturnType<typeof setInterval> | null | undefined {
        return this._state.runningTimers[classId];
    }

    setRunningTimer(classId: string | number, timerHandle: ReturnType<typeof setInterval>): void {
        this._state.runningTimers[classId] = timerHandle;
    }

    clearRunningTimer(classId: string | number, shouldClearInterval: boolean = true): void {
        const timerHandle = this._state.runningTimers[classId];
        if (shouldClearInterval && timerHandle) {
            clearInterval(timerHandle);
        }
        this._state.runningTimers[classId] = null;
    }

    // -------------------------------------------------------------------------
    // Rate limits
    // -------------------------------------------------------------------------

    getRateLimits(): Record<string, Record<string, number[]>> {
        return this._state.rateLimits;
    }

    getUserRateLimits(email: string, create: boolean = false): Record<string, number[]> | undefined {
        if (create && !this._state.rateLimits[email]) {
            this._state.rateLimits[email] = {};
        }
        return this._state.rateLimits[email];
    }

    clearUserRateLimits(email: string): void {
        delete this._state.rateLimits[email];
    }

    // -------------------------------------------------------------------------
    // Connected sockets by email
    // -------------------------------------------------------------------------

    getUserSockets(): Record<string, Record<string, Socket>> {
        return this._state.userSockets;
    }

    getUserSocketsByEmail(email: string): Record<string, Socket> | undefined {
        return this._state.userSockets[email];
    }

    setUserSocket(email: string, socketId: string, socket: Socket): void {
        if (!this._state.userSockets[email]) {
            this._state.userSockets[email] = {};
        }
        this._state.userSockets[email][socketId] = socket;
    }

    removeUserSocket(email: string, socketId: string): SocketRemovalResult {
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

    hasUserSockets(email: string): boolean {
        const sockets = this._state.userSockets[email];
        return !!(sockets && Object.keys(sockets).length > 0);
    }

    // -------------------------------------------------------------------------
    // Inactivity tracking
    // -------------------------------------------------------------------------

    getLastActivities(): Record<string, Record<string, SocketActivity>> {
        return this._state.lastActivities;
    }

    getUserLastActivities(email: string): Record<string, SocketActivity> | undefined {
        return this._state.lastActivities[email];
    }

    touchLastActivity(email: string, socketId: string, socket: Socket, time: number = Date.now()): void {
        if (!this._state.lastActivities[email]) {
            this._state.lastActivities[email] = {};
        }
        this._state.lastActivities[email][socketId] = { socket, time };
    }

    removeLastActivity(email: string, socketId: string): void {
        if (!this._state.lastActivities[email]) return;

        delete this._state.lastActivities[email][socketId];
        if (Object.keys(this._state.lastActivities[email]).length === 0) {
            delete this._state.lastActivities[email];
        }
    }

    clearUserLastActivities(email: string): void {
        delete this._state.lastActivities[email];
    }
}

const socketStateStore = new SocketStateStore();

module.exports = {
    SocketStateStore,
    socketStateStore,
};
