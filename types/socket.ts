import { Socket } from "socket.io";

// Socket.IO event type definitions

export interface ServerToClientEvents {
    error: (data: { message: string; event?: string }) => void;
    updateStudents: (data: unknown) => void;
    updatePolls: (data: unknown) => void;
    updateTimer: (data: unknown) => void;
    updateBreaks: (data: unknown) => void;
    updateHelp: (data: unknown) => void;
    updateLinks: (data: unknown) => void;
    updateTags: (data: unknown) => void;
    updateClass: (data: unknown) => void;
    updateUser: (data: unknown) => void;
    updateDigipogs: (data: unknown) => void;
    updateAuxiliary: (data: unknown) => void;
    pollEnded: (data: unknown) => void;
    pollCleared: () => void;
    timerUpdate: (data: unknown) => void;
    kicked: (data: { reason?: string }) => void;
    classEnded: () => void;
    notification: (data: unknown) => void;
    [event: string]: (...args: unknown[]) => void;
}

export interface ClientToServerEvents {
    joinClass: (classId: number | string) => void;
    leaveClass: () => void;
    startClass: () => void;
    endClass: () => void;
    createPoll: (data: unknown) => void;
    votePoll: (data: unknown) => void;
    endPoll: () => void;
    clearPoll: () => void;
    savePoll: (data: unknown) => void;
    sharePoll: (data: unknown) => void;
    removePoll: (data: unknown) => void;
    updatePoll: (data: unknown) => void;
    startTimer: (data: unknown) => void;
    pauseTimer: () => void;
    resumeTimer: () => void;
    endTimer: () => void;
    clearTimer: () => void;
    requestBreak: (data: unknown) => void;
    approveBreak: (data: unknown) => void;
    denyBreak: (data: unknown) => void;
    endBreak: (data: unknown) => void;
    requestHelp: (data: unknown) => void;
    deleteHelp: (data: unknown) => void;
    updateTags: (data: unknown) => void;
    awardDigipogs: (data: unknown) => void;
    transferDigipogs: (data: unknown) => void;
    disconnect: () => void;
    [event: string]: (...args: unknown[]) => void;
}

export interface InterServerEvents {
    [event: string]: (...args: unknown[]) => void;
}

export interface SocketData {
    email?: string;
    userId?: number;
    user?: Record<string, unknown>;
    [key: string]: unknown;
}

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
