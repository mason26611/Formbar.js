const { dbGetAll, dbRun } = require("@modules/database");

function parseScopes(value) {
    if (Array.isArray(value)) {
        return value.filter((scope) => typeof scope === "string");
    }

    if (typeof value !== "string" || !value.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((scope) => typeof scope === "string") : [];
    } catch {
        return [];
    }
}

async function appendScopeToNamedRoles(database, roleName, scope) {
    const rows = await dbGetAll(`SELECT id, scopes FROM roles WHERE name = ?`, [roleName], database);
    for (const row of rows) {
        const scopes = parseScopes(row.scopes);
        if (scopes.includes(scope)) {
            continue;
        }

        scopes.push(scope);
        await dbRun(`UPDATE roles SET scopes = ? WHERE id = ?`, [JSON.stringify(scopes), row.id], database);
    }
}

module.exports = {
    async run(database) {
        await appendScopeToNamedRoles(database, "Banned", "global.system.blocked");
        await appendScopeToNamedRoles(database, "Banned", "class.system.blocked");
        await appendScopeToNamedRoles(database, "Mod", "global.system.moderate");
        await appendScopeToNamedRoles(database, "Manager", "class.system.admin");

        console.log("Migration 26 completed: scope markers backfilled for built-in role presets.");
    },
};
