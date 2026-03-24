/**
 * ClassCodeCacheStore
 * In-memory cache for class code => class id lookups.
 */
class ClassCodeCacheStore {
    private _cache: Record<string, number>;

    constructor() {
        this._cache = {};
    }

    get(code: string): number | undefined {
        return this._cache[code];
    }

    set(code: string, classId: number): void {
        this._cache[code] = classId;
    }

    delete(code: string): void {
        delete this._cache[code];
    }

    clear(): void {
        this._cache = {};
    }

    invalidateByClassId(classId: number): void {
        for (const [code, id] of Object.entries(this._cache)) {
            if (id === classId) {
                delete this._cache[code];
            }
        }
    }

    getAll(): Record<string, number> {
        return this._cache;
    }
}

const classCodeCacheStore = new ClassCodeCacheStore();

module.exports = {
    ClassCodeCacheStore,
    classCodeCacheStore,
};
