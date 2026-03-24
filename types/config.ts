export interface AppSettings {
    port: number;
    whitelist: boolean;
    blacklist: boolean;
    emailEnabled: boolean;
    googleOauthEnabled: boolean;
    rateLimitWindowMs: number;
    rateLimitMultiplier: number;
}

export interface RateLimitConfig {
    maxAttempts: number;
    lockoutMinutes: number;
    attemptWindowMinutes: number;
}

export interface AppConfig {
    settings: AppSettings;
    publicKey: string;
    privateKey: string;
    frontendUrl: string;
    rateLimit: RateLimitConfig;
}
