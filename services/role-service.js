const { dbGetAll, dbGet, dbRun } = require("@modules/database");
const { classStateStore } = require("@services/classroom-service");
const { ROLES, ROLE_NAMES } = require("@modules/roles");
const { resolveClassScopes, getAllClassScopes } = require("@modules/scope-resolver");
const { requireInternalParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

const BUILT_IN_ROLE_NAMES = new Set(Object.values(ROLE_NAMES));

/**
 * Returns all valid class scope strings.
 * @returns {Set<string>}
 */
function getValidClassScopes() {
    return new Set(getAllClassScopes());
}

/**
 * Returns all roles available for a class: built-in defaults + custom class roles.
 * @param {string|number} classId
 * @returns {Promise<Array<{id: number|null, name: string, scopes: string[], builtIn: boolean}>>}
 */
async function getClassRoles(classId) {
    requireInternalParam(classId, "classId");

    // Built-in roles with their default class scopes
    const roles = Object.entries(ROLES).map(([name, definition]) => ({
        id: null,
        name,
        scopes: [...definition.class],
        builtIn: true,
    }));

    // Custom roles from DB
    const customRows = await dbGetAll("SELECT id, name, scopes FROM roles WHERE classId = ?", [classId]);
    for (const row of customRows) {
        let scopes = [];
        try {
            scopes = JSON.parse(row.scopes);
        } catch {
            scopes = [];
        }
        roles.push({
            id: row.id,
            name: row.name,
            scopes,
            builtIn: false,
        });
    }

    return roles;
}

/**
 * Creates a custom role for a class.
 * @param {string|number} classId
 * @param {string} name
 * @param {string[]} scopes
 * @param {Object} actingClassUser - The class user creating the role (for privilege escalation check)
 * @param {Object} classroom - The classroom object
 * @returns {Promise<{id: number, name: string, scopes: string[]}>}
 */
async function createClassRole(classId, name, scopes, actingClassUser, classroom) {
    requireInternalParam(classId, "classId");

    validateRoleName(name);
    validateScopes(scopes);
    validateNoPrivilegeEscalation(scopes, actingClassUser, classroom);

    // Check name doesn't conflict with built-in roles
    if (BUILT_IN_ROLE_NAMES.has(name)) {
        throw new ValidationError(`Cannot use built-in role name "${name}".`);
    }

    // Check name doesn't conflict with existing custom roles in this class
    const existing = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [name, classId]);
    if (existing) {
        throw new ValidationError(`A custom role named "${name}" already exists in this class.`);
    }

    const scopesJson = JSON.stringify(scopes);
    const id = await dbRun("INSERT INTO roles (name, classId, scopes) VALUES (?, ?, ?)", [name, classId, scopesJson]);

    // Update in-memory custom roles
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        if (!classroomObj.customRoles) classroomObj.customRoles = {};
        classroomObj.customRoles[name] = scopes;
    }

    return { id, name, scopes };
}

/**
 * Updates a custom role.
 * @param {number} roleId
 * @param {string|number} classId
 * @param {Object} updates - { name?: string, scopes?: string[] }
 * @param {Object} actingClassUser - The class user updating the role
 * @param {Object} classroom - The classroom object
 * @returns {Promise<{id: number, name: string, scopes: string[]}>}
 */
async function updateClassRole(roleId, classId, updates, actingClassUser, classroom) {
    requireInternalParam(roleId, "roleId");
    requireInternalParam(classId, "classId");

    const role = await dbGet("SELECT * FROM roles WHERE id = ? AND classId = ?", [roleId, classId]);
    if (!role) {
        throw new NotFoundError("Custom role not found in this class.");
    }

    const oldName = role.name;
    const newName = updates.name !== undefined ? updates.name : role.name;
    let newScopes;
    try {
        newScopes = updates.scopes !== undefined ? updates.scopes : JSON.parse(role.scopes);
    } catch {
        newScopes = [];
    }

    if (updates.name !== undefined) {
        validateRoleName(newName);
        if (BUILT_IN_ROLE_NAMES.has(newName)) {
            throw new ValidationError(`Cannot use built-in role name "${newName}".`);
        }
        // Check for conflicts with other custom roles
        if (newName !== oldName) {
            const conflict = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ? AND id != ?", [newName, classId, roleId]);
            if (conflict) {
                throw new ValidationError(`A custom role named "${newName}" already exists in this class.`);
            }
        }
    }

    if (updates.scopes !== undefined) {
        validateScopes(newScopes);
        validateNoPrivilegeEscalation(newScopes, actingClassUser, classroom);
    }

    const scopesJson = JSON.stringify(newScopes);
    await dbRun("UPDATE roles SET name = ?, scopes = ? WHERE id = ?", [newName, scopesJson, roleId]);

    // Update in-memory custom roles
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj && classroomObj.customRoles) {
        if (oldName !== newName) {
            delete classroomObj.customRoles[oldName];
        }
        classroomObj.customRoles[newName] = newScopes;
    }

    // If the role was renamed, update students who have the old role name
    if (oldName !== newName) {
        await dbRun("UPDATE classusers SET role = ? WHERE classId = ? AND role = ?", [newName, classId, oldName]);
        if (classroomObj) {
            for (const student of Object.values(classroomObj.students)) {
                if (student.classRole === oldName) {
                    student.classRole = newName;
                }
            }
        }
    }

    return { id: roleId, name: newName, scopes: newScopes };
}

/**
 * Deletes a custom role. Students with this role are reassigned to Guest.
 * @param {number} roleId
 * @param {string|number} classId
 * @returns {Promise<void>}
 */
async function deleteClassRole(roleId, classId) {
    requireInternalParam(roleId, "roleId");
    requireInternalParam(classId, "classId");

    const role = await dbGet("SELECT * FROM roles WHERE id = ? AND classId = ?", [roleId, classId]);
    if (!role) {
        throw new NotFoundError("Custom role not found in this class.");
    }

    const roleName = role.name;

    // Reassign students with this role to Guest
    await dbRun("UPDATE classusers SET role = ? WHERE classId = ? AND role = ?", [ROLE_NAMES.GUEST, classId, roleName]);

    // Remove role assignments from user_roles
    await dbRun("DELETE FROM user_roles WHERE roleId = ? AND classId = ?", [roleId, classId]);

    // Delete the role
    await dbRun("DELETE FROM roles WHERE id = ?", [roleId]);

    // Update in-memory state
    const classroom = classStateStore.getClassroom(classId);
    if (classroom) {
        if (classroom.customRoles) {
            delete classroom.customRoles[roleName];
        }
        for (const student of Object.values(classroom.students)) {
            if (student.classRole === roleName) {
                student.classRole = ROLE_NAMES.GUEST;
            }
        }
    }
}

/**
 * Assigns a role to a student within a class.
 * @param {string|number} classId
 * @param {number} userId
 * @param {string} roleName
 * @returns {Promise<void>}
 */
async function assignStudentRole(classId, userId, roleName) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");
    requireInternalParam(roleName, "roleName");

    // Validate role exists (built-in or custom for this class)
    const isBuiltIn = BUILT_IN_ROLE_NAMES.has(roleName);
    if (!isBuiltIn) {
        const customRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [roleName, classId]);
        if (!customRole) {
            throw new ValidationError(`Role "${roleName}" does not exist in this class.`);
        }
    }

    // Verify user is in the class
    const classUser = await dbGet("SELECT * FROM classusers WHERE classId = ? AND studentId = ?", [classId, userId]);
    if (!classUser) {
        throw new NotFoundError("User is not a member of this class.");
    }

    // Update in DB
    await dbRun("UPDATE classusers SET role = ? WHERE classId = ? AND studentId = ?", [roleName, classId, userId]);

    // Update in-memory
    const classroom = classStateStore.getClassroom(classId);
    if (classroom) {
        const email = await getEmailForUserId(userId);
        if (email && classroom.students[email]) {
            classroom.students[email].classRole = roleName;
        }
    }
}

/**
 * Loads custom roles for a class from the database.
 * @param {string|number} classId
 * @returns {Promise<Object<string, string[]>>} Map of role name to scopes array
 */
async function loadCustomRoles(classId) {
    const rows = await dbGetAll("SELECT name, scopes FROM roles WHERE classId = ?", [classId]);
    const customRoles = {};
    for (const row of rows) {
        try {
            customRoles[row.name] = JSON.parse(row.scopes);
        } catch {
            customRoles[row.name] = [];
        }
    }
    return customRoles;
}

// --- Validation helpers ---

function validateRoleName(name) {
    if (typeof name !== "string" || name.trim().length === 0) {
        throw new ValidationError("Role name must be a non-empty string.");
    }
    if (name.length > 50) {
        throw new ValidationError("Role name cannot exceed 50 characters.");
    }
}

function validateScopes(scopes) {
    if (!Array.isArray(scopes)) {
        throw new ValidationError("Scopes must be an array of strings.");
    }
    const validScopes = getValidClassScopes();
    for (const scope of scopes) {
        if (typeof scope !== "string") {
            throw new ValidationError("Each scope must be a string.");
        }
        if (!validScopes.has(scope)) {
            throw new ValidationError(`Invalid scope: "${scope}".`);
        }
    }
}

/**
 * Ensures the acting user isn't granting scopes they don't have.
 */
function validateNoPrivilegeEscalation(scopes, actingClassUser, classroom) {
    const actorScopes = new Set(resolveClassScopes(actingClassUser, classroom));
    for (const scope of scopes) {
        if (!actorScopes.has(scope)) {
            throw new ForbiddenError(`Cannot grant scope "${scope}" — you do not have it yourself.`);
        }
    }
}

async function getEmailForUserId(userId) {
    const row = await dbGet("SELECT email FROM users WHERE id = ?", [userId]);
    return row ? row.email : null;
}

module.exports = {
    getClassRoles,
    createClassRole,
    updateClassRole,
    deleteClassRole,
    assignStudentRole,
    loadCustomRoles,
    BUILT_IN_ROLE_NAMES,
};
