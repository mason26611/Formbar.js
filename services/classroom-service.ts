import type { ClassroomRow } from "../types/database";

interface ClassroomIdRow {
    id: number;
}

const { database, dbGet } = require("@modules/database") as {
    database: { get: (sql: string, params: unknown[], cb: (err: Error | null, row: ClassroomIdRow | undefined) => void) => void };
    dbGet: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
};
const { DEFAULT_CLASS_PERMISSIONS } = require("@modules/permissions") as { DEFAULT_CLASS_PERMISSIONS: Record<string, number> };
const { ClassStateStore } = require("@stores/class-state-store") as { ClassStateStore: new () => { getClassroom: (id: string | number) => unknown; setClassroom: (id: string | number, classroom: unknown) => void } };
const { classCodeCacheStore } = require("@stores/class-code-cache-store") as { classCodeCacheStore: { get: (code: string) => number | undefined; set: (code: string, id: number) => void } };
const { requireInternalParam } = require("@modules/error-wrapper") as { requireInternalParam: (param: unknown, name: string) => void };

const classStateStore = new ClassStateStore();

interface ClassSettings {
    mute: boolean;
    filter: string;
    sort: string;
    isExcluded: {
        guests: boolean;
        mods: boolean;
        teachers: boolean;
    };
    [key: string]: unknown;
}

interface PollState {
    status: boolean;
    prompt: string;
    responses: string[];
    allowTextResponses: boolean;
    allowMultipleResponses: boolean;
    blind: boolean;
    weight: number;
    excludedRespondents: string[];
}

interface TimerState {
    startTime: number;
    endTime: number;
    active: boolean;
    sound: boolean;
}

interface StudentMap {
    [email: string]: Record<string, unknown>;
}

interface ClassroomParams {
    id?: number;
    className?: string;
    key?: string;
    owner?: number;
    permissions?: string | Record<string, number>;
    tags?: string[];
    settings?: ClassSettings;
}

const DEFAULT_CLASS_SETTINGS: ClassSettings = {
    mute: false,
    filter: "",
    sort: "",
    isExcluded: {
        guests: false,
        mods: true,
        teachers: true,
    },
};

class Classroom {
    id: number | undefined;
    className: string | undefined;
    isActive: boolean;
    owner: number | undefined;
    students: StudentMap;
    poll: PollState;
    key: string | undefined;
    permissions: Record<string, number>;
    tags: string[];
    settings: ClassSettings;
    timer: TimerState;

    constructor({ id, className, key, owner, permissions, tags, settings }: ClassroomParams = {}) {
        this.id = id;
        this.className = className;
        this.isActive = false;
        this.owner = owner;
        this.students = {};
        this.poll = {
            status: false,
            prompt: "",
            responses: [],
            allowTextResponses: false,
            allowMultipleResponses: false,
            blind: false,
            weight: 1,
            excludedRespondents: [],
        };
        this.key = key;

        try {
            this.permissions = typeof permissions === "string" ? JSON.parse(permissions) : permissions || DEFAULT_CLASS_PERMISSIONS;
        } catch (_err) {
            this.permissions = DEFAULT_CLASS_PERMISSIONS;
        }

        this.tags = tags || ["Offline", "Excluded"];
        this.settings = settings || { ...DEFAULT_CLASS_SETTINGS };
        this.timer = {
            startTime: 0,
            endTime: 0,
            active: false,
            sound: false,
        };

        for (const settingKey of Object.keys(DEFAULT_CLASS_SETTINGS)) {
            if (!this.settings[settingKey]) {
                this.settings[settingKey] = DEFAULT_CLASS_SETTINGS[settingKey as keyof ClassSettings];
            }
        }

        if (!this.tags.includes("Offline") && Array.isArray(this.tags)) {
            this.tags.push("Offline");
        }
    }
}

function getClassroomFromDb(id: number): Promise<ClassroomRow | undefined> {
    requireInternalParam(id, "id");
    return dbGet<ClassroomRow>("SELECT * FROM classroom WHERE id = ?", [id]);
}

function getClassIDFromCode(code: string): number | Promise<number | null> {
    const cachedClassId: number | undefined = classCodeCacheStore.get(code);
    if (cachedClassId) {
        return cachedClassId;
    }

    return new Promise<number | null>((resolve, reject) => {
        database.get("SELECT id FROM classroom WHERE key = ?", [code], (err: Error | null, classroom: ClassroomIdRow | undefined) => {
            if (err) {
                reject(err);
                return;
            }

            if (!classroom) {
                resolve(null);
                return;
            }

            classCodeCacheStore.set(code, classroom.id);
            resolve(classroom.id);
        });
    });
}

module.exports = {
    Classroom,
    classStateStore,
    getClassroomFromDb,
    getClassIDFromCode,
};
