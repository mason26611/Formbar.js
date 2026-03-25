
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

module.exports = {
    getAvailableProviders
}