import crypto = require("crypto");
import jwt = require("jsonwebtoken");

const { compare, hash } = require("bcrypt") as {
    compare: (data: string, encrypted: string) => Promise<boolean>;
    hash: (data: string, saltOrRounds: number) => Promise<string>;
};
const { dbGet, dbRun, dbGetAll } = require("@modules/database") as {
    dbGet: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    dbRun: (sql: string, params?: unknown[]) => Promise<number>;
    dbGetAll: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
};
const { privateKey, publicKey } = require("@modules/config") as {
    privateKey: string;
    publicKey: string;
};
const { MANAGER_PERMISSIONS, STUDENT_PERMISSIONS } = require("@modules/permissions") as {
    MANAGER_PERMISSIONS: number;
    STUDENT_PERMISSIONS: number;
};
const { requireInternalParam } = require("@modules/error-wrapper") as {
    requireInternalParam: (param: unknown, name: string) => void;
};
const { sha256 } = require("@modules/crypto") as { sha256: (input: string) => string };
const { resolveUserScopes, getUserRoleName } = require("@modules/scope-resolver") as {
    resolveUserScopes: (user: UserLike | null | undefined) => string[];
    getUserRoleName: (user: UserLike) => string;
};
const AppError = require("@errors/app-error") as new (
    message: string,
    options?: { statusCode?: number; event?: string; reason?: string }
) => Error & { statusCode: number; isOperational: boolean; event?: string; reason?: string };
const ValidationError = require("@errors/validation-error") as new (
    message: string,
    options?: { statusCode?: number; event?: string; reason?: string }
) => Error & { statusCode: number };
const ConflictError = require("@errors/conflict-error") as new (
    message: string,
    options?: { statusCode?: number; event?: string; reason?: string }
) => Error & { statusCode: number };

// --- Row types from the database schema ---

interface UserRow {
    id: number;
    email: string;
    password: string | null;
    permissions: number;
    role: string | null;
    API: string;
    secret: string;
    tags: string | null;
    digipogs: number;
    displayName: string | null;
    verified: number;
    pin: string | null;
}

interface RefreshTokenRow {
    user_id: number;
    token_hash: string;
    exp: number;
    token_type: "auth" | "oauth";
}

interface UsedAuthorizationCodeRow {
    code_hash: string;
    used_at: number;
    expires_at: number;
}

// --- Scope-resolver user shape ---

interface UserLike {
    role?: string | null;
    permissions?: number;
    [key: string]: unknown;
}

// --- Token payload interfaces ---

interface AccessTokenPayload {
    id: number;
    email: string;
    displayName: string | null;
    iat?: number;
    exp?: number;
}

interface RefreshTokenPayload {
    id: number;
    jti?: string;
    iat?: number;
    exp?: number;
}

interface LegacyOAuthTokenPayload {
    id: number;
    email: string;
    displayName: string | null;
    permissions: number;
    iat?: number;
    exp?: number;
}

interface AuthorizationCodePayload {
    sub: number;
    aud: string;
    redirect_uri: string;
    scope: string;
    iat?: number;
    exp?: number;
}

// --- Return type interfaces ---

interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}

interface LoginTokens extends AuthTokens {
    legacyToken: string;
}

interface AuthResult {
    tokens: AuthTokens;
    user: UserRow;
}

interface LoginResult {
    tokens: LoginTokens;
    user: UserRow;
}

interface OAuthTokenResponse {
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    refresh_token: string;
    permissions: number;
    role: string;
    scopes: string[];
}

interface VerifyTokenError {
    error: string;
}

interface InvalidCredentialsError extends Error {
    code: string;
}

// --- Function parameter interfaces ---

interface GenerateAuthCodeParams {
    client_id: string;
    redirect_uri: string;
    scope: string;
    authorization: string;
}

interface ExchangeCodeParams {
    code: string;
    redirect_uri: string;
    client_id: string;
}

interface ExchangeRefreshParams {
    refresh_token: string;
}

// --- Partial user types used by token-generation helpers ---

interface TokenUserData {
    id: number;
    email: string;
    displayName: string | null;
}

interface LegacyTokenUserData extends TokenUserData {
    permissions: number;
}

// --- Regex ---

const passwordRegex = /^[a-zA-Z0-9!@#$%^&*()\-_=+{}\[\]<>,.:;'"~?\/|\\]{5,20}$/;
const displayRegex = /^[a-zA-Z0-9_ ]{5,20}$/;

async function register(email: string, password: string, displayName: string): Promise<AuthResult> {
    if (!privateKey || !publicKey) {
        throw new AppError("Either the public key or private key is not available for JWT signing.", {
            event: "auth.register.failed",
            reason: "missing_keys",
        });
    }

    if (!passwordRegex.test(password)) {
        throw new ValidationError("Password must be 5-20 characters long and can only contain letters, numbers, and special characters.", {
            event: "auth.register.failed",
            reason: "invalid_password",
        });
    }

    if (!displayRegex.test(displayName)) {
        throw new ValidationError("Display name must be 5-20 characters long and can only contain letters, numbers, spaces, and underscores.", {
            event: "auth.register.failed",
            reason: "invalid_display_name",
        });
    }

    // Normalize email to lowercase to prevent duplicate accounts
    email = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await dbGet<UserRow>("SELECT * FROM users WHERE email = ? OR displayName = ?", [email, displayName]);
    if (existingUser) {
        throw new ConflictError("A user with that email or display name already exists.", { event: "auth.register.failed", reason: "user_exists" });
    }

    const hashedPassword = await hash(password, 10);
    const apiKey = crypto.randomBytes(64).toString("hex");
    const secret = crypto.randomBytes(256).toString("hex");

    // Determine permissions
    // The first user always gets manager permissions
    const allUsers = await dbGetAll<UserRow>("SELECT * FROM users", []);
    const permissions = allUsers.length === 0 ? MANAGER_PERMISSIONS : STUDENT_PERMISSIONS;

    // Create the new user in the database
    const userId = await dbRun(`INSERT INTO users (email, password, permissions, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        email,
        hashedPassword,
        permissions,
        apiKey,
        secret,
        displayName,
        0,
    ]);

    // Get the new user's data
    const userData = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
    if (!userData) {
        throw new AppError("Failed to retrieve newly created user.", { statusCode: 500 });
    }

    // Generate tokens
    const tokens = generateAuthTokens(userData);
    const decodedRefreshToken = jwt.decode(tokens.refreshToken) as RefreshTokenPayload;
    const tokenHash = sha256(tokens.refreshToken);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        userData.id,
        tokenHash,
        decodedRefreshToken.exp,
        "auth",
    ]);

    return { tokens, user: userData };
}

async function login(email: string, password: string): Promise<LoginResult | InvalidCredentialsError> {
    if (!privateKey || !publicKey) {
        throw new AppError("Either the public key or private key is not available for JWT signing.", {
            statusCode: 500,
            event: "auth.login.failed",
            reason: "missing_keys",
        });
    }

    // Normalize email to lowercase to prevent login issues
    email = email.trim().toLowerCase();

    const userData = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
    if (!userData) {
        return invalidCredentials();
    }

    const passwordMatches = await compare(password, userData.password ?? "");
    if (passwordMatches) {
        const tokens = generateAuthTokens(userData);
        const decodedRefreshToken = jwt.decode(tokens.refreshToken) as RefreshTokenPayload;
        const tokenHash = sha256(tokens.refreshToken);

        // Each refresh token includes a random `jti` so tokens generated in the
        // same second will have different hashes and won't collide.
        await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
            userData.id,
            tokenHash,
            decodedRefreshToken.exp,
            "auth",
        ]);

        // Generate a legacy OAuth token (includes permissions) for backwards-compatible
        // third-party apps (e.g. Jukebar) that use the /oauth redirect flow.
        const legacyToken = generateLegacyOAuthToken(userData);

        return { tokens: { ...tokens, legacyToken }, user: userData };
    } else {
        return invalidCredentials();
    }
}

async function refreshLogin(refreshToken: string): Promise<AuthTokens | InvalidCredentialsError> {
    // Verify the refresh token's signature and expiration before proceeding
    // This prevents the use of expired or tampered tokens
    try {
        jwt.verify(refreshToken, publicKey, { algorithms: ["RS256"] });
    } catch {
        return invalidCredentials();
    }

    const tokenHash = sha256(refreshToken);
    const dbRefreshToken = await dbGet<RefreshTokenRow>("SELECT * FROM refresh_tokens WHERE token_hash = ? AND token_type = 'auth'", [tokenHash]);
    if (!dbRefreshToken) {
        return invalidCredentials();
    }

    // Load user data to include email and displayName in the new token
    const userData = await dbGet<Pick<UserRow, "id" | "email" | "displayName">>("SELECT id, email, displayName FROM users WHERE id = ?", [dbRefreshToken.user_id]);
    if (!userData) {
        return invalidCredentials();
    }

    const authTokens = generateAuthTokens(userData);
    const decodedRefreshToken = jwt.decode(authTokens.refreshToken) as RefreshTokenPayload;

    // Delete the old refresh token and insert the new one to avoid UNIQUE constraint issues
    // This handles cases where a user might have multiple refresh tokens in the database
    const newTokenHash = sha256(authTokens.refreshToken);
    await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ?", [tokenHash]);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        dbRefreshToken.user_id,
        newTokenHash,
        decodedRefreshToken.exp,
        "auth",
    ]);

    return authTokens;
}

function generateAuthTokens(userData: TokenUserData): AuthTokens {
    const refreshToken = generateRefreshToken(userData);
    const accessToken = jwt.sign(
        {
            id: userData.id,
            email: userData.email,
            displayName: userData.displayName,
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "15m" }
    );

    return { accessToken, refreshToken };
}

function generateRefreshToken(userData: Pick<TokenUserData, "id">): string {
    return jwt.sign({ id: userData.id, jti: crypto.randomBytes(16).toString("hex") }, privateKey, { algorithm: "RS256", expiresIn: "30d" });
}

function generateLegacyOAuthToken(userData: LegacyTokenUserData): string {
    return jwt.sign(
        {
            id: userData.id,
            email: userData.email,
            displayName: userData.displayName,
            permissions: userData.permissions,
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "1h" }
    );
}

function verifyToken(token: string): AccessTokenPayload | VerifyTokenError {
    try {
        return jwt.verify(token, publicKey, { algorithms: ["RS256"] }) as AccessTokenPayload;
    } catch (err: unknown) {
        return { error: String(err) };
    }
}

function invalidCredentials(): InvalidCredentialsError {
    const err = new Error("Invalid credentials") as InvalidCredentialsError;
    err.code = "INVALID_CREDENTIALS";
    return err;
}

async function googleOAuth(email: string, displayName: string): Promise<AuthResult> {
    if (!privateKey || !publicKey) {
        throw new AppError("Either the public key or private key is not available for JWT signing.", {
            statusCode: 500,
            event: "auth.oauth.failed",
            reason: "missing_keys",
        });
    }

    // Normalize email to lowercase to prevent duplicate accounts
    email = email.trim().toLowerCase();

    let userData = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
    if (!userData) {
        // User doesn't exist, create a new one
        const apiKey = crypto.randomBytes(64).toString("hex");
        const secret = crypto.randomBytes(256).toString("hex");

        // Determine permissions
        // The first user always gets manager permissions
        const allUsers = await dbGetAll<UserRow>("SELECT * FROM users", []);
        const permissions = allUsers.length === 0 ? MANAGER_PERMISSIONS : STUDENT_PERMISSIONS;

        // Insert the new user
        // Users registered through google oauth will have no password
        const userId = await dbRun(
            `INSERT INTO users (email, password, permissions, API, secret, displayName, verified) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [email, "", permissions, apiKey, secret, displayName, 1] // Automatically verified via Google
        );

        // Get the newly created user
        userData = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
        if (!userData) {
            throw new AppError("Failed to retrieve newly created Google OAuth user.", { statusCode: 500 });
        }
    }

    // Generate tokens
    const tokens = generateAuthTokens(userData);
    const decodedRefreshToken = jwt.decode(tokens.refreshToken) as RefreshTokenPayload;

    // Store refresh token (replace if exists for this user's auth tokens only)
    const tokenHash = sha256(tokens.refreshToken);
    await dbRun("DELETE FROM refresh_tokens WHERE user_id = ? AND token_type = 'auth'", [userData.id]);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        userData.id,
        tokenHash,
        decodedRefreshToken.exp,
        "auth",
    ]);

    return { tokens, user: userData };
}

function generateAuthorizationCode({ client_id, redirect_uri, scope, authorization }: GenerateAuthCodeParams): string {
    requireInternalParam(client_id, "client_id");
    requireInternalParam(redirect_uri, "redirect_uri");
    requireInternalParam(scope, "scope");
    requireInternalParam(authorization, "authorization");

    const userData = verifyToken(authorization);
    if ("error" in userData) {
        throw new AppError("Invalid authorization token provided.", { statusCode: 400 });
    }

    return jwt.sign(
        {
            sub: userData.id,
            aud: client_id,
            redirect_uri: redirect_uri,
            scope: scope,
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "5m" }
    );
}

async function exchangeAuthorizationCodeForToken({ code, redirect_uri, client_id }: ExchangeCodeParams): Promise<OAuthTokenResponse> {
    requireInternalParam(code, "code");
    requireInternalParam(redirect_uri, "redirect_uri");
    requireInternalParam(client_id, "client_id");

    const authorizationCodeData = verifyToken(code);
    if ("error" in authorizationCodeData) {
        throw new AppError("Invalid authorization code provided.", { statusCode: 400 });
    }

    // The authorization code payload uses `sub` and `aud` fields (not `id` and `email`)
    const codePayload = authorizationCodeData as unknown as AuthorizationCodePayload;

    // Check if the authorization code has already been used (single-use per RFC 6749 Section 10.5)
    const codeHash = sha256(code);
    const usedCode = await dbGet<UsedAuthorizationCodeRow>("SELECT * FROM used_authorization_codes WHERE code_hash = ?", [codeHash]);
    if (usedCode) {
        throw new AppError("Authorization code has already been used.", { statusCode: 400 });
    }

    // Mark the authorization code as used
    await dbRun("INSERT INTO used_authorization_codes (code_hash, used_at, expires_at) VALUES (?, ?, ?)", [
        codeHash,
        Math.floor(Date.now() / 1000),
        codePayload.exp,
    ]);

    // Ensure the redirect_uri and client_id match those embedded in the authorization code
    if (codePayload.redirect_uri !== redirect_uri) {
        throw new AppError("redirect_uri does not match the original authorization request.", { statusCode: 400 });
    }
    if (codePayload.aud !== client_id) {
        throw new AppError("client_id does not match the original authorization request.", { statusCode: 400 });
    }

    // Load user details so the OAuth access token includes the same claims as regular access tokens
    const user = await dbGet<Pick<UserRow, "id" | "email" | "displayName" | "permissions">>(
        "SELECT id, email, displayName, permissions FROM users WHERE id = ?",
        [codePayload.sub]
    );
    if (!user) {
        throw new AppError("User associated with the authorization code was not found.", { statusCode: 404 });
    }

    const tokenPayload: AccessTokenPayload = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
    };

    const accessToken = jwt.sign(tokenPayload, privateKey, { algorithm: "RS256", expiresIn: "15m" });
    const refreshToken = jwt.sign({ id: user.id }, privateKey, { algorithm: "RS256", expiresIn: "30d" });
    const decodedRefreshToken = jwt.decode(refreshToken) as RefreshTokenPayload;

    // Persist the OAuth refresh token to the database (store hash, not cleartext)
    const refreshTokenHash = sha256(refreshToken);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        codePayload.sub,
        refreshTokenHash,
        decodedRefreshToken.exp,
        "oauth",
    ]);

    return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 900,
        refresh_token: refreshToken,
        permissions: user.permissions,
        role: getUserRoleName(user),
        scopes: resolveUserScopes(user),
    };
}

async function exchangeRefreshTokenForAccessToken({ refresh_token }: ExchangeRefreshParams): Promise<OAuthTokenResponse> {
    requireInternalParam(refresh_token, "refresh_token");

    const refreshTokenData = verifyToken(refresh_token);
    if ("error" in refreshTokenData) {
        throw new AppError("Invalid refresh token provided.", { statusCode: 400 });
    }

    // Verify the refresh token exists in the database as an OAuth token (compare hashes)
    const tokenHash = sha256(refresh_token);
    const dbRefreshToken = await dbGet<RefreshTokenRow>("SELECT * FROM refresh_tokens WHERE token_hash = ? AND token_type = 'oauth'", [tokenHash]);
    if (!dbRefreshToken) {
        throw new AppError("Refresh token not found or has been revoked.", { statusCode: 401 });
    }

    // Load user details so the OAuth access token includes the same claims as regular access tokens
    const user = await dbGet<Pick<UserRow, "id" | "email" | "displayName" | "permissions">>(
        "SELECT id, email, displayName, permissions FROM users WHERE id = ?",
        [refreshTokenData.id]
    );
    if (!user) {
        throw new AppError("User associated with the refresh token was not found.", { statusCode: 404 });
    }

    const tokenPayload: AccessTokenPayload = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
    };

    const accessToken = jwt.sign(tokenPayload, privateKey, { algorithm: "RS256", expiresIn: "15m" });
    const newRefreshToken = jwt.sign(tokenPayload, privateKey, { algorithm: "RS256", expiresIn: "30d" });
    const decodedRefreshToken = jwt.decode(newRefreshToken) as RefreshTokenPayload;

    // Rotate the refresh token: delete old, insert new (store hash, not cleartext)
    const newTokenHash = sha256(newRefreshToken);
    await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ?", [tokenHash]);
    await dbRun("INSERT INTO refresh_tokens (user_id, token_hash, exp, token_type) VALUES (?, ?, ?, ?)", [
        refreshTokenData.id,
        newTokenHash,
        decodedRefreshToken.exp,
        "oauth",
    ]);

    return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 900,
        refresh_token: newRefreshToken,
        permissions: user.permissions,
        role: getUserRoleName(user),
        scopes: resolveUserScopes(user),
    };
}

async function revokeOAuthToken(token: string): Promise<boolean> {
    requireInternalParam(token, "token");

    // Delete the token from the database (only OAuth tokens, compare by hash)
    const tokenHash = sha256(token);
    await dbRun("DELETE FROM refresh_tokens WHERE token_hash = ? AND token_type = 'oauth'", [tokenHash]);
    return true;
}

async function cleanupExpiredAuthorizationCodes(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await dbRun("DELETE FROM used_authorization_codes WHERE expires_at < ?", [now]);
}

module.exports = {
    register,
    login,
    refreshLogin,
    verifyToken,
    googleOAuth,
    generateAuthorizationCode,
    exchangeAuthorizationCodeForToken,
    exchangeRefreshTokenForAccessToken,
    revokeOAuthToken,
    cleanupExpiredAuthorizationCodes,
    generateLegacyOAuthToken,
};
