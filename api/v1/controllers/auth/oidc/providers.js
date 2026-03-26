const oidc = require("@modules/oidc.js");
const { generators } = require("openid-client");
const NotFoundError = require("@errors/not-found-error");
const { settings } = require("@modules/config");

const availableProviders = oidc.getAvailableProviders();
function assertProviderSupported(provider) {
    if (!availableProviders.includes(provider)) {
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
                providers: availableProviders,
            },
        });
    });

    router.get("/auth/oidc/:provider", (req, res, next) => {
        const provider = req.params.provider;
        assertProviderSupported(provider);

        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);
        const state = generators.state();
    });

    router.get("/auth/oidc/:provider/callback", (req, res, next) => {
        const provider = req.params.provider;
        assertProviderSupported(provider);
    });
};
