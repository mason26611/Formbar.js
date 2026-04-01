const oidc = require("@modules/oidc.js");
const NotFoundError = require("@errors/not-found-error");

function assertProviderSupported(provider) {
    if (!oidc.getClient(provider)) {
        throw new NotFoundError("Requested provider not found.", {
            event: "auth.oidc.provider.not_found",
            reason: "provider_not_found",
        });
    }
}

module.exports = (router) => {
    router.get("/auth/oidc/providers", (req, res, next) => {
        res.json(200).send({
            success: true,
            data: {
                providers: oidc.getAvailableProviders(),
            },
        });
    });

    router.get("/auth/oidc/:provider", async (req, res, next) => {
        const provider = req.params.provider;
        assertProviderSupported(provider);

        const client = await import("openid-client");
        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
        const state = client.randomState();

        const parameters = {
            redirect_uri: `http://localhost:420/api/v1/auth/oidc/${provider}/callback`,
            scope: "openid email profile",
            response_type: "code",
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
        };

        const providerClient = oidc.getClient(provider);
        const authUrl = client.buildAuthorizationUrl(providerClient, parameters);
        res.redirect(authUrl);
    });

    router.get("/auth/oidc/:provider/callback", (req, res, next) => {
        const provider = req.params.provider;
        assertProviderSupported(provider);

        console.log(req);
    });
};
