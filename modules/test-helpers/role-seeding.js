const { LEVEL_TO_ROLE, ROLE_NAMES } = require("@modules/roles");

async function getRoleRow(mockDatabase, roleName, classId = null) {
    if (classId == null) {
        return mockDatabase.dbGet("SELECT id, name, scopes, color FROM roles WHERE name = ? AND classId IS NULL", [roleName]);
    }
    return mockDatabase.dbGet("SELECT id, name, scopes, color FROM roles WHERE name = ? AND classId = ?", [roleName, classId]);
}

async function setGlobalPermissionLevel(mockDatabase, userId, permissionLevel) {
    const roleName = LEVEL_TO_ROLE[permissionLevel];
    await mockDatabase.dbRun("DELETE FROM user_roles WHERE userId = ? AND classId IS NULL", [userId]);

    if (!roleName) {
        return null;
    }

    const role = await getRoleRow(mockDatabase, roleName, null);
    if (!role) {
        return null;
    }

    await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, NULL)", [userId, role.id]);
    return role.name;
}

async function addClassMemberWithPermission(mockDatabase, userId, classId, permissionLevel, options = {}) {
    const existing = await mockDatabase.dbGet("SELECT 1 FROM classusers WHERE classId = ? AND studentId = ?", [classId, userId]);
    if (!existing) {
        await mockDatabase.dbRun("INSERT INTO classusers (classId, studentId, digiPogs) VALUES (?, ?, ?)", [
            classId,
            userId,
            options.digiPogs ?? null,
        ]);
    }

    await mockDatabase.dbRun("DELETE FROM user_roles WHERE userId = ? AND classId = ?", [userId, classId]);

    const roleName = LEVEL_TO_ROLE[permissionLevel];
    if (!roleName || roleName === ROLE_NAMES.GUEST) {
        return roleName || null;
    }

    let role = await getRoleRow(mockDatabase, roleName, classId);
    if (!role) {
        const globalRole = await getRoleRow(mockDatabase, roleName, null);
        if (globalRole) {
            await mockDatabase.dbRun("INSERT INTO roles (name, classId, scopes, color) VALUES (?, ?, ?, ?)", [
                roleName,
                classId,
                globalRole.scopes,
                globalRole.color,
            ]);
            role = await getRoleRow(mockDatabase, roleName, classId);
        }
    }
    if (role) {
        await mockDatabase.dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, role.id, classId]);
    }

    return roleName;
}

module.exports = {
    getRoleRow,
    setGlobalPermissionLevel,
    addClassMemberWithPermission,
};
