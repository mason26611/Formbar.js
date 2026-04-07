const oidc = require("@modules/oidc.js");
const authService = require("@services/auth-service");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const { classStateStore } = require("@services/classroom-service");
const { createStudentFromUserData } = require("@services/student-service");

function assertProviderSupported(provider) {
    try {
        return oidc.getClient(provider);
    } catch (err) {
        throw new NotFoundError("Requested provider not found.", {
            event: "auth.oidc.provider.not_found",
            reason: "provider_not_found",
        });
    }
}

function buildCallbackUrl(req, provider) {
    return `${req.protocol}://${req.get("host")}/api/v1/auth/oidc/${provider}/callback`;
}

function getRedirectTarget(req, tokens) {
    const clientOrigin = req.session?.oauthOrigin;
    if (!clientOrigin) {
        return null;
    }

    delete req.session.oauthOrigin;
    const redirect = new URL(clientOrigin);
    const existingHash = redirect.hash ? redirect.hash.replace(/^#/, "") : "";
    const hashParams = new URLSearchParams(existingHash);
    hashParams.set("accessToken", tokens.accessToken);
    hashParams.set("refreshToken", tokens.refreshToken);
    if (tokens.legacyToken) {
        hashParams.set("legacyToken", tokens.legacyToken);
    }
    redirect.hash = hashParams.toString();
    return redirect.toString();
}

function getEmailFromClaims(provider, claims) {
    const directEmail = typeof claims?.email === "string" ? claims.email : null;
    if (directEmail) {
        return directEmail;
    }

    if (provider === "microsoft") {
        const preferredUsername = typeof claims?.preferred_username === "string" ? claims.preferred_username : null;
        if (preferredUsername && preferredUsername.includes("@")) {
            return preferredUsername;
        }
    }

    return null;
}

function getDisplayNameFromClaims(claims, email) {
    const name = typeof claims?.name === "string" ? claims.name.trim() : "";
    if (name) {
        return name;
    }

    const givenName = typeof claims?.given_name === "string" ? claims.given_name.trim() : "";
    const familyName = typeof claims?.family_name === "string" ? claims.family_name.trim() : "";
    const combinedName = `${givenName} ${familyName}`.trim();
    return combinedName || email;
}

module.exports = (router) => {
    router.get("/auth/oidc/providers", (req, res) => {
        res.status(200).json({
            success: true,
            data: {
                providers: oidc.getAvailableProviders(),
            },
        });
    });

    router.get("/auth/oidc/:provider", async (req, res) => {
        const provider = req.params.provider;
        const providerClient = assertProviderSupported(provider);
        const client = await import("openid-client");

        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
        const state = client.randomState();
        const nonce = client.randomNonce();

        req.session.oidcAuth = {
            provider,
            codeVerifier,
            state,
            nonce,
        };
        if (req.query.origin) {
            req.session.oauthOrigin = String(req.query.origin);
        }

        const authUrl = client.buildAuthorizationUrl(providerClient, {
            redirect_uri: buildCallbackUrl(req, provider),
            scope: "openid email profile",
            response_type: "code",
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
            nonce,
        });

        res.redirect(authUrl.toString());
    });

    router.get("/auth/oidc/:provider/callback", async (req, res) => {
        const provider = req.params.provider;
        const providerClient = assertProviderSupported(provider);
        const authSession = req.session?.oidcAuth;

        if (!authSession || authSession.provider !== provider) {
            throw new ValidationError("Authentication session is invalid or has expired.", {
                event: "auth.oidc.callback.invalid_session",
                reason: "missing_session",
            });
        }

        const client = await import("openid-client");
        const currentUrl = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
        const tokens = await client.authorizationCodeGrant(providerClient, currentUrl, {
            pkceCodeVerifier: authSession.codeVerifier,
            expectedState: authSession.state,
            expectedNonce: authSession.nonce,
        });

        delete req.session.oidcAuth;

        let claims = tokens.claims() || {};
        if ((!claims.email || claims.email_verified === undefined) && tokens.access_token) {
            const userInfo = await client.fetchUserInfo(providerClient, tokens.access_token, claims.sub || client.skipSubjectCheck);
            claims = { ...userInfo, ...claims };
        }

        const email = getEmailFromClaims(provider, claims);
        if (!email) {
            throw new ValidationError("Could not retrieve email from OAuth account.", {
                event: "auth.oidc.callback.no_email",
                reason: "email_not_found",
            });
        }

        const displayName = getDisplayNameFromClaims(claims, email);
        const result = await authService.oidcOAuth(provider, email, displayName, {
            emailVerified: claims.email_verified !== false,
        });

        const { user: userData } = result;
        if (!classStateStore.getUser(userData.email)) {
            classStateStore.setUser(userData.email, createStudentFromUserData(userData, { isGuest: false }));
        }

        const redirectTarget = getRedirectTarget(req, result.tokens);
        if (redirectTarget) {
            req.infoEvent("auth.oidc.callback.redirect", "Redirecting to SPA after OIDC OAuth", { provider });
            return res.redirect(redirectTarget);
        }

        res.status(200).json({
            success: true,
            data: {
                ...result.tokens,
                user: {
                    id: userData.id,
                    email: userData.email,
                    displayName: userData.displayName,
                },
            },
        });
    });
};
