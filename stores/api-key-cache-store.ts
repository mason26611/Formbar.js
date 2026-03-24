import { ApiKeyCacheEntry } from "../types/stores";

/**
 * ApiKeyCacheStore
 * In-memory cache for API key -> email lookups with TTL.
 */
class ApiKeyCacheStore {
    private _cache: Map<string, ApiKeyCacheEntry>;
    private _defaultTtlMs: number;

    constructor(defaultTtlMs: number = 10 * 60 * 1000) {
        this._cache = new Map();
        this._defaultTtlMs = defaultTtlMs;
    }

    get(apiKey: string): string | undefined {
        const entry = this._cache.get(apiKey);
        if (!entry) return undefined;

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this._cache.delete(apiKey);
            return undefined;
        }

        return entry.email;
    }

    set(apiKey: string, email: string, ttlMs: number = this._defaultTtlMs): void {
        const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
        this._cache.set(apiKey, { email, expiresAt });
    }

    delete(apiKey: string): void {
        this._cache.delete(apiKey);
    }

    clear(): void {
        this._cache.clear();
    }

    invalidateByEmail(email: string): void {
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
