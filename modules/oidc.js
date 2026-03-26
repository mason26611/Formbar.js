const crypto = require("crypto");
const { sha256 } = require("@modules/crypto");

const possibleProviders = ["google", "microsoft"]
function getAvailableProviders() {
    const availableProviders = [];
    for (const provider of possibleProviders) {
        const issuer = process.env[`${provider.toUpperCase()}_OIDC_ISSUER`];
        const clientId = process.env[`${provider.toUpperCase()}_OIDC_ISSUER`];
        const clientSecret = process.env[`${provider.toUpperCase()}_OIDC_ISSUER`];

        // If one of these is missing, mark it as unavailable
        if (!issuer || !clientId || !clientSecret) {
            continue;
        }

        availableProviders.push(provider);
    }

    return availableProviders;
}

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier) {
    return sha256(verifier);
}

function generateState(returnUrl) {
    return {
        csrf: crypto.randomBytes(16).toString("base64url"),
        returnUrl,
    };
}

module.exports = {
    getAvailableProviders,
    generateCodeVerifier,
    generateCodeChallenge,
    generateState
}