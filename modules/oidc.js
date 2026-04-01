const NotFoundError = require("@errors/not-found-error");

let openIdClientPromise;
function getOpenIdClient() {
    if (!openIdClientPromise) {
        openIdClientPromise = import("openid-client");
    }

    return openIdClientPromise;
}

const clients = new Map();

function getClient(provider) {
    if (!clients.has(provider)) {
        throw new NotFoundError(`Client for provider ${provider} not found`);
    }
    return clients.get(provider);
}

const possibleProviders = ["google", "microsoft"];
function getAvailableProviders() {
    const availableProviders = [];
    for (const provider of possibleProviders) {
        const issuer = process.env[`${provider.toUpperCase()}_OIDC_ISSUER`];
        const clientId = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_ID`];
        const clientSecret = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_SECRET`];

        // If one of these is missing, mark it as unavailable
        if (!issuer || !clientId || !clientSecret) {
            continue;
        }

        availableProviders.push(provider);
    }

    return availableProviders;
}

async function initializeAvailableProviders() {
    const client = await getOpenIdClient();
    const providers = getAvailableProviders();
    for (const provider of providers) {
        const issuer = process.env[`${provider.toUpperCase()}_OIDC_ISSUER`];
        const clientId = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_ID`];
        const clientSecret = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_SECRET`];

        const config = await client.discovery(new URL(issuer), clientId, clientSecret);
        clients.set(provider, config);
    }
}

module.exports = {
    getAvailableProviders,
    initializeAvailableProviders,
    getClient
};
