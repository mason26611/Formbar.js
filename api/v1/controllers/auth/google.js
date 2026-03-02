const { classStateStore } = require("@services/classroom-service");
const { Student } = require("@services/student-service");
const { settings } = require("@modules/config");
const { passport } = require("@modules/google-oauth");
const authService = require("@services/auth-service");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");

// Middleware to check if Google OAuth is enabled
function checkEnabled(req, res, next) {
    if (settings.googleOauthEnabled) {
        next();
    } else {
        throw new ForbiddenError("Google OAuth is not enabled on this server.");
    }
}

module.exports = (router) => {
    // Initiate Google OAuth flow
    // Accepts an optional `origin` query parameter which is stored in the session
    // so the callback can redirect the browser back to the SPA with tokens.
    router.get(
        "/auth/google",
        checkEnabled,
        (req, res, next) => {
            // Persist the caller's origin so the callback can redirect back
            if (req.query.origin) {
                req.session.oauthOrigin = String(req.query.origin);
            }
            next();
        },
        passport.authenticate("google", {
            scope: ["profile", "email"],
            session: false,
        })
    );

    /**
     * @swagger
     * /api/v1/auth/google/callback:
     *   get:
     *     summary: Google OAuth callback
     *     tags:
     *       - Authentication
     *     description: Handles the callback from Google OAuth and returns authentication tokens
     *     responses:
     *       200:
     *         description: Authentication successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 accessToken:
     *                   type: string
     *                 refreshToken:
     *                   type: string
     *       400:
     *         description: Authentication failed or email not available
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Google OAuth is not enabled
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    // Google OAuth callback
    router.get("/auth/google/callback", checkEnabled, (req, res, next) => {
        passport.authenticate("google", { session: false }, async (err, user) => {
            if (err) {
                throw new ValidationError("Authentication failed.", { event: "auth.google.error", reason: "passport_error" });
            }

            if (!user || !user.emails || user.emails.length === 0) {
                throw new ValidationError("Could not retrieve email from Google account.", {
                    event: "auth.google.no_email",
                    reason: "email_not_found",
                });
            }

            const email = user.emails[0].value;
            const displayName = user.name ? `${user.name.givenName} ${user.name.familyName}` : email;

            req.infoEvent("auth.google.callback", "Google OAuth callback");

            // Authenticate the user via Google OAuth
            const result = await authService.googleOAuth(email, displayName);
            if (result.error) {
                throw new ValidationError(result.error, { event: "auth.google.oauth_error", reason: "oauth_failed" });
            }

            // If not already logged in, create a new Student instance in classInformation
            const { tokens, user: userData } = result;
            if (!classStateStore.getUser(email)) {
                classStateStore.setUser(
                    email,
                    new Student(
                        userData.email,
                        userData.id,
                        userData.permissions,
                        userData.API,
                        JSON.parse(userData.ownedPolls || "[]"),
                        JSON.parse(userData.sharedPolls || "[]"),
                        userData.tags ? userData.tags.split(",") : [],
                        userData.displayName,
                        false
                    )
                );
            }

            // If the request came from the SPA via a browser redirect (origin stored
            // in session), redirect back to the client login page with the tokens so
            // the SPA can complete the login flow without an extra round-trip.
            const clientOrigin = req.session?.oauthOrigin;
            if (clientOrigin) {
                delete req.session.oauthOrigin;
                req.infoEvent("auth.google.callback.redirect", "Redirecting to SPA after Google OAuth");
                const redirect = new URL(clientOrigin);
                // Place tokens in the URL fragment instead of query parameters to
                // avoid leaking them via Referer headers and intermediary logs.
                const existingHash = redirect.hash ? redirect.hash.replace(/^#/, "") : "";
                const hashParams = new URLSearchParams(existingHash);
                hashParams.set("accessToken", tokens.accessToken);
                hashParams.set("refreshToken", tokens.refreshToken);
                redirect.hash = hashParams.toString();
                return res.redirect(redirect.toString());
            }

            // Fallback for direct API consumers: return tokens as JSON
            res.json({
                success: true,
                data: {
                    ...result.tokens,
                    user: {
                        id: result.user.id,
                        email: result.user.email,
                        displayName: result.user.displayName,
                    },
                },
            });
        })(req, res, next);
    });
};
