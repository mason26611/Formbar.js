/**
 * ApiKeyCacheStore
 * In-memory cache for API key -> email lookups with TTL.
 */
class ApiKeyCacheStore {
    constructor(defaultTtlMs = 10 * 60 * 1000) {
        this._cache = new Map();
        this._defaultTtlMs = defaultTtlMs;
    }

    get(apiKey) {
        const entry = this._cache.get(apiKey);
        if (!entry) return undefined;

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this._cache.delete(apiKey);
            return undefined;
        }

        return entry.email;
    }

    set(apiKey, email, ttlMs = this._defaultTtlMs) {
        const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
        this._cache.set(apiKey, { email, expiresAt });
    }

    delete(apiKey) {
        this._cache.delete(apiKey);
    }

    clear() {
        this._cache.clear();
    }

    invalidateByEmail(email) {
        for (const [apiKey, entry] of this._cache.entries()) {
            if (entry.email === email) {
                this._cache.delete(apiKey);
            }
        }
    }
}

const apiKeyCacheStore = new ApiKeyCacheStore();

module.exports = {
    ApiKeyCacheStore,
    apiKeyCacheStore,
};
