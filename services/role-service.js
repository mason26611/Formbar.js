const { dbGetAll, dbGet, dbRun } = require("@modules/database");
const { classStateStore } = require("@services/classroom-service");
const { ROLES, ROLE_NAMES, ROLE_TO_LEVEL, LEVEL_TO_ROLE } = require("@modules/roles");
const { resolveClassScopes, getAllClassScopes } = require("@modules/scope-resolver");
const { computePrimaryRole } = require("@services/student-service");
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
                // Update multi-role array
                if (Array.isArray(student.classRoles)) {
                    const idx = student.classRoles.indexOf(oldName);
                    if (idx !== -1) {
                        student.classRoles[idx] = newName;
                    }
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
            // Remove from multi-role array
            if (Array.isArray(student.classRoles)) {
                const idx = student.classRoles.indexOf(roleName);
                if (idx !== -1) {
                    student.classRoles.splice(idx, 1);
                    student.classRole = computePrimaryRole(student.classRoles);
                }
            } else if (student.classRole === roleName) {
                student.classRole = ROLE_NAMES.GUEST;
                student.classRoles = [];
            }
        }
    }
}

/**
 * Adds a role to a student within a class (multi-role).
 * Inserts into user_roles and updates in-memory state.
 * @param {string|number} classId
 * @param {number} userId
 * @param {string} roleName
 * @param {Object} [actingClassUser] - The class user performing the action (for privilege escalation check)
 * @param {Object} [classroom] - The classroom object
 * @returns {Promise<void>}
 */
async function addStudentRole(classId, userId, roleName, actingClassUser, classroom) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");
    requireInternalParam(roleName, "roleName");

    if (roleName === ROLE_NAMES.GUEST) {
        throw new ValidationError("Guest is an implicit base role and cannot be assigned.");
    }

    // Validate role exists (built-in or custom for this class)
    const isBuiltIn = BUILT_IN_ROLE_NAMES.has(roleName);
    let roleId;
    if (isBuiltIn) {
        const builtInRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId IS NULL", [roleName]);
        if (!builtInRole) throw new ValidationError(`Built-in role "${roleName}" not found.`);
        roleId = builtInRole.id;
    } else {
        const customRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [roleName, classId]);
        if (!customRole) {
            throw new ValidationError(`Role "${roleName}" does not exist in this class.`);
        }
        roleId = customRole.id;
    }

    // Privilege escalation check
    if (actingClassUser && classroom) {
        validateNoPrivilegeEscalationForRole(roleName, actingClassUser, classroom);
    }

    // Verify user is in the class
    const classUser = await dbGet("SELECT * FROM classusers WHERE classId = ? AND studentId = ?", [classId, userId]);
    if (!classUser) {
        throw new NotFoundError("User is not a member of this class.");
    }

    // Check if already assigned
    const existing = await dbGet("SELECT 1 FROM user_roles WHERE userId = ? AND roleId = ? AND classId = ?", [userId, roleId, classId]);
    if (existing) {
        throw new ValidationError(`User already has the "${roleName}" role.`);
    }

    // Insert into user_roles
    await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, roleId, classId]);

    // Update in-memory
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        const email = await getEmailForUserId(userId);
        if (email && classroomObj.students[email]) {
            const student = classroomObj.students[email];
            if (!Array.isArray(student.classRoles)) student.classRoles = [];
            if (!student.classRoles.includes(roleName)) {
                student.classRoles.push(roleName);
            }
            student.classRole = computePrimaryRole(student.classRoles);
        }
    }
}

/**
 * Removes a role from a student within a class (multi-role).
 * Deletes from user_roles and updates in-memory state.
 * @param {string|number} classId
 * @param {number} userId
 * @param {string} roleName
 * @returns {Promise<void>}
 */
async function removeStudentRole(classId, userId, roleName) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");
    requireInternalParam(roleName, "roleName");

    if (roleName === ROLE_NAMES.GUEST) {
        throw new ValidationError("Guest is an implicit base role and cannot be removed.");
    }

    // Find the role ID
    let roleId;
    const isBuiltIn = BUILT_IN_ROLE_NAMES.has(roleName);
    if (isBuiltIn) {
        const builtInRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId IS NULL", [roleName]);
        if (!builtInRole) throw new ValidationError(`Built-in role "${roleName}" not found.`);
        roleId = builtInRole.id;
    } else {
        const customRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [roleName, classId]);
        if (!customRole) throw new ValidationError(`Role "${roleName}" does not exist in this class.`);
        roleId = customRole.id;
    }

    // Check the assignment exists
    const existing = await dbGet("SELECT 1 FROM user_roles WHERE userId = ? AND roleId = ? AND classId = ?", [userId, roleId, classId]);
    if (!existing) {
        throw new ValidationError(`User does not have the "${roleName}" role.`);
    }

    // Delete from user_roles
    await dbRun("DELETE FROM user_roles WHERE userId = ? AND roleId = ? AND classId = ?", [userId, roleId, classId]);

    // Update in-memory
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        const email = await getEmailForUserId(userId);
        if (email && classroomObj.students[email]) {
            const student = classroomObj.students[email];
            if (Array.isArray(student.classRoles)) {
                const idx = student.classRoles.indexOf(roleName);
                if (idx !== -1) student.classRoles.splice(idx, 1);
            }
            student.classRole = computePrimaryRole(student.classRoles || []);
        }
    }
}

/**
 * Gets all role names assigned to a student in a class.
 * @param {string|number} classId
 * @param {number} userId
 * @returns {Promise<string[]>} Array of role names
 */
async function getStudentRoles(classId, userId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");

    const rows = await dbGetAll(
        `SELECT r.name FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.classId = ? AND ur.userId = ?`,
        [classId, userId]
    );
    return rows.map((r) => r.name);
}

/**
 * Assigns a single role to a student, replacing all existing roles (legacy/backward compat).
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

    // Clear all existing role assignments for this user in this class
    await dbRun("DELETE FROM user_roles WHERE userId = ? AND classId = ?", [userId, classId]);

    // If setting to Guest (or empty), just clear — Guest is implicit
    if (roleName !== ROLE_NAMES.GUEST) {
        // Find role ID
        let roleId;
        if (isBuiltIn) {
            const builtInRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId IS NULL", [roleName]);
            roleId = builtInRole.id;
        } else {
            const customRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [roleName, classId]);
            roleId = customRole.id;
        }
        await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, roleId, classId]);
    }

    // Update legacy classusers.role column
    await dbRun("UPDATE classusers SET role = ? WHERE classId = ? AND studentId = ?", [roleName, classId, userId]);

    // Update in-memory
    const classroom = classStateStore.getClassroom(classId);
    if (classroom) {
        const email = await getEmailForUserId(userId);
        if (email && classroom.students[email]) {
            const student = classroom.students[email];
            student.classRoles = roleName === ROLE_NAMES.GUEST ? [] : [roleName];
            student.classRole = roleName === ROLE_NAMES.GUEST ? null : roleName;
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

/**
 * Validates that a role name is a non-empty string within the length limit.
 * @param {string} name
 * @throws {ValidationError} If the name is empty or exceeds 50 characters.
 */
function validateRoleName(name) {
    if (typeof name !== "string" || name.trim().length === 0) {
        throw new ValidationError("Role name must be a non-empty string.");
    }
    if (name.length > 50) {
        throw new ValidationError("Role name cannot exceed 50 characters.");
    }
}

/**
 * Validates that scopes is an array of known class scope strings.
 * @param {string[]} scopes
 * @throws {ValidationError} If scopes is not an array or contains invalid scope strings.
 */
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

/**
 * Ensures the acting user isn't assigning a role whose scopes exceed their own.
 */
function validateNoPrivilegeEscalationForRole(roleName, actingClassUser, classroom) {
    // Get the scopes the role would grant
    let roleScopes = [];
    const roleDefinition = ROLES[roleName];
    if (roleDefinition) {
        roleScopes = roleDefinition.class;
    } else if (classroom && classroom.customRoles && classroom.customRoles[roleName]) {
        roleScopes = classroom.customRoles[roleName];
    }

    // Also check hierarchy: can't assign a built-in role at or above your own level
    const actorLevel = getActorLevel(actingClassUser);
    const roleLevel = ROLE_TO_LEVEL[roleName];
    if (roleLevel !== undefined && roleLevel >= actorLevel) {
        throw new ForbiddenError(`Cannot assign the "${roleName}" role — it is at or above your level.`);
    }

    validateNoPrivilegeEscalation(roleScopes, actingClassUser, classroom);
}

/**
 * Determines the hierarchy level of the acting class user for privilege escalation checks.
 * Checks classRoles (multi-role), classRole (single), then classPermissions (numeric fallback).
 * @param {Object} classUser - The class user object.
 * @returns {number} The highest hierarchy level (0=Banned, 1=Guest, 2=Student, 3=Mod, 4=Teacher, 5=Manager).
 */
function getActorLevel(classUser) {
    if (!classUser) return 0;

    // Check multi-role first
    if (Array.isArray(classUser.classRoles) && classUser.classRoles.length > 0) {
        let highest = 0;
        for (const role of classUser.classRoles) {
            highest = Math.max(highest, ROLE_TO_LEVEL[role] ?? 0);
        }
        return highest;
    }

    if (classUser.classRole && ROLE_TO_LEVEL[classUser.classRole] !== undefined) {
        return ROLE_TO_LEVEL[classUser.classRole];
    }

    return ROLE_TO_LEVEL[ROLE_NAMES.GUEST] ?? 0;
}

/**
 * Looks up a user's email address by their numeric user ID.
 * @param {number} userId
 * @returns {Promise<string|null>} The email address, or null if not found.
 */
async function getEmailForUserId(userId) {
    const row = await dbGet("SELECT email FROM users WHERE id = ?", [userId]);
    return row ? row.email : null;
}

/**
 * Gets the acting class user, handling the case where the user is the class owner.
 * Owners who aren't in the students map get a synthetic Manager-level user object.
 * @param {Object} classroom - The classroom object from classStateStore
 * @param {Object} reqUser - The authenticated user from req.user
 * @returns {Object|null} The class user object, or null if not found
 */
function getActingUser(classroom, reqUser) {
    if (!classroom) return null;
    const student = classroom.students[reqUser.email];
    if (student) return student;

    if (classroom.owner === reqUser.id || classroom.owner === reqUser.email) {
        return { classRoles: ["Manager"], classRole: "Manager", classPermissions: 5 };
    }
    return null;
}

module.exports = {
    getClassRoles,
    createClassRole,
    updateClassRole,
    deleteClassRole,
    addStudentRole,
    removeStudentRole,
    getStudentRoles,
    assignStudentRole,
    loadCustomRoles,
    getActingUser,
    BUILT_IN_ROLE_NAMES,
};
