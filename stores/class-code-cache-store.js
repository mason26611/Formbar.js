/**
 * ClassCodeCacheStore
 * In-memory cache for class code => class id lookups.
 */
class ClassCodeCacheStore {
    constructor() {
        this._cache = {};
    }

    get(code) {
        return this._cache[code];
    }

    set(code, classId) {
        this._cache[code] = classId;
    }

    delete(code) {
        delete this._cache[code];
    }

    clear() {
        this._cache = {};
    }

    invalidateByClassId(classId) {
        for (const [code, id] of Object.entries(this._cache)) {
            if (id == classId) {
                delete this._cache[code];
            }
        }
    }

    getAll() {
        return this._cache;
    }
}

const classCodeCacheStore = new ClassCodeCacheStore();

module.exports = {
    ClassCodeCacheStore,
    classCodeCacheStore,
};
