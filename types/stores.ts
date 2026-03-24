import { Socket } from "socket.io";

// Store state type definitions

export interface ApiKeyCacheEntry {
    email: string;
    expiresAt: number | null;
}

export interface ClassStudent {
    email: string;
    displayName: string | null;
    tags: string | null;
    permissions: number;
    role: string | null;
    break?: boolean;
    help?: boolean;
    [key: string]: unknown;
}

export interface ClassroomState {
    id: number;
    name: string;
    owner: number;
    poll?: unknown;
    timer?: unknown;
    auxiliary?: unknown;
    students: Record<string, ClassStudent>;
    [key: string]: unknown;
}

export interface UserState {
    email: string;
    id: number;
    displayName: string | null;
    permissions: number;
    role: string | null;
    verified: number;
    digipogs: number;
    classId?: number;
    activeClass?: number;
    classPermissions?: number;
    classRole?: string;
    [key: string]: unknown;
}

export interface ClassStateShape {
    users: Record<string, UserState>;
    classrooms: Record<string | number, ClassroomState>;
}

export interface SocketActivity {
    socket: Socket;
    time: number;
}

export interface SocketStateShape {
    runningTimers: Record<string | number, ReturnType<typeof setInterval> | null>;
    rateLimits: Record<string, Record<string, number[]>>;
    userSockets: Record<string, Record<string, Socket>>;
    lastActivities: Record<string, Record<string, SocketActivity>>;
}

export interface PollRuntimeShape {
    pogMeterIncreasedByClass: Record<string | number, Record<string, boolean>>;
    pollStartTimes: Record<string | number, number>;
    lastSavedPollIds: Record<string | number, number>;
}
