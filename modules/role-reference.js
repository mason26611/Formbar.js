function getRoleName(role) {
    if (typeof role === "string") {
        return role;
    }

    if (role && typeof role === "object" && typeof role.name === "string") {
        return role.name;
    }

    return null;
}

function getRoleId(role) {
    if (!role || typeof role !== "object") {
        return null;
    }

    if (typeof role.id === "number") {
        return role.id;
    }

    return null;
}

function buildRoleReference(role) {
    const id = getRoleId(role);
    const name = getRoleName(role);

    if (id == null || !name) {
        return null;
    }

    return { id, name };
}

function buildRoleReferences(roles) {
    if (!Array.isArray(roles)) {
        return [];
    }

    return roles.map((role) => buildRoleReference(role)).filter(Boolean);
}

function getRoleNames(roles) {
    if (!Array.isArray(roles)) {
        return [];
    }

    return roles.map((role) => getRoleName(role)).filter(Boolean);
}

module.exports = {
    getRoleName,
    getRoleId,
    getRoleNames,
    buildRoleReference,
    buildRoleReferences,
};
