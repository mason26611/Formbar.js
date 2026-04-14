const { dbGetAll, dbGet, dbRun } = require("@modules/database");
const { classStateStore } = require("@services/classroom-service");
const { ROLES, ROLE_NAMES, DEFAULT_ROLE_COLORS } = require("@modules/roles");
const { computeClassPermissionLevel, computeGlobalPermissionLevel, GUEST_PERMISSIONS } = require("@modules/permissions");
const { getUserScopes, getAllClassScopes } = require("@modules/scope-resolver");
const { computePrimaryRole } = require("@services/student-service");
const { requireInternalParam } = require("@modules/error-wrapper");
const { buildRoleReference, buildRoleReferences } = require("@modules/role-reference");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");
const { getUser } = require("@services/user-service");

const BUILT_IN_ROLE_NAMES = new Set(Object.values(ROLE_NAMES));
const DEFAULT_CLASS_ROLE_NAMES = Object.values(ROLE_NAMES);

/**
 * Returns default class scopes for a role name.
 * @param {string} roleName
 * @returns {string[]}
 */
function getDefaultClassRoleScopes(roleName) {
    return [...(ROLES[roleName]?.class || [])];
}

/**
 * Seeds class-scoped default roles when a class has no built-in defaults yet.
 * This enables default roles to be modified per class without touching global rows.
 * @param {string|number} classId
 * @returns {Promise<void>}
 */
async function ensureDefaultClassRoles(classId) {
    requireInternalParam(classId, "classId");

    const existingRows = await dbGetAll("SELECT id FROM roles WHERE classId = ?", [classId]);
    if (existingRows.length > 0) {
        return;
    }

    for (const roleName of DEFAULT_CLASS_ROLE_NAMES) {
        await dbRun("INSERT OR IGNORE INTO roles (name, classId, scopes, color) VALUES (?, ?, ?, ?)", [
            roleName,
            classId,
            JSON.stringify(getDefaultClassRoleScopes(roleName)),
            DEFAULT_ROLE_COLORS[roleName] || "#808080",
        ]);
    }
}

/**
 * Returns all valid class scope strings.
 * @returns {Set<string>}
 */
function getValidClassScopes() {
    return new Set(getAllClassScopes());
}

/**
 * Safely parses a stored scopes JSON field.
 * @param {string|string[]|null|undefined} scopes
 * @returns {string[]}
 */
function parseStoredScopes(scopes) {
    if (Array.isArray(scopes)) {
        return scopes.filter((scope) => typeof scope === "string");
    }

    if (typeof scopes !== "string" || scopes.trim().length === 0) {
        return [];
    }

    try {
        const parsed = JSON.parse(scopes);
        return Array.isArray(parsed) ? parsed.filter((scope) => typeof scope === "string") : [];
    } catch {
        return [];
    }
}

/**
 * Maps a database role row into the API/service response shape.
 * @param {{id: number, name: string, scopes?: string|string[]}} role
 * @returns {{id: number, name: string, scopes: string[]}}
 */
function buildRoleResponse(role) {
    return {
        id: role.id,
        name: role.name,
        scopes: parseStoredScopes(role.scopes),
        color: role.color || DEFAULT_ROLE_COLORS[role.name] || "#808080",
    };
}

function getAvailableRoleById(classroom, roleId) {
    if (!classroom || !Array.isArray(classroom.availableRoles)) {
        return null;
    }

    return classroom.availableRoles.find((role) => Number(role.id) === Number(roleId)) || null;
}

function getAvailableRoleByName(classroom, roleName) {
    if (!classroom || !Array.isArray(classroom.availableRoles)) {
        return null;
    }

    return classroom.availableRoles.find((role) => role.name === roleName) || null;
}

function buildScopesKey(scopes) {
    return [...new Set(parseStoredScopes(scopes))].sort().join("|");
}

function getClassRolePermissionLevel(role) {
    return computeClassPermissionLevel(parseStoredScopes(role.scopes));
}

function getGlobalRolePermissionLevel(role) {
    return computeGlobalPermissionLevel(parseStoredScopes(role.scopes));
}

function isImplicitGuestRole(role) {
    return (
        getClassRolePermissionLevel(role) === GUEST_PERMISSIONS &&
        buildScopesKey(role.scopes) === buildScopesKey(ROLES[ROLE_NAMES.GUEST]?.class || [])
    );
}

/**
 * Resolves a role by ID for a specific class.
 * Accepts class-scoped role IDs and maps legacy global IDs to the closest
 * class-scoped role by scopes rather than by name.
 * @param {string|number} classId
 * @param {string|number} roleId
 * @returns {Promise<{id: number, name: string, classId: number|null, scopes: string}|null>}
 */
async function getRoleByIdForClass(classId, roleId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(roleId, "roleId");

    await ensureDefaultClassRoles(classId);

    const classRole = await dbGet("SELECT id, name, classId, scopes, color FROM roles WHERE id = ? AND classId = ?", [roleId, classId]);
    if (classRole) {
        return classRole;
    }

    // Backward compatibility for clients still sending legacy global role IDs.
    const globalRole = await dbGet("SELECT id, name, classId, scopes, color FROM roles WHERE id = ? AND classId IS NULL", [roleId]);
    if (!globalRole) {
        return null;
    }

    const classRoles = await dbGetAll("SELECT id, name, classId, scopes, color FROM roles WHERE classId = ?", [classId]);
    const globalScopesKey = buildScopesKey(globalRole.scopes);
    const exactMatch = classRoles.find((candidate) => buildScopesKey(candidate.scopes) === globalScopesKey);
    if (exactMatch) {
        return exactMatch;
    }

    return classRoles.find((candidate) => getClassRolePermissionLevel(candidate) === getGlobalRolePermissionLevel(globalRole)) || null;
}

/**
 * Returns all roles available for a class from class-scoped role rows.
 * @param {string|number} classId
 * @returns {Promise<Array<{id: number, name: string, scopes: string[]}>>}
 */
async function getClassRoles(classId) {
    requireInternalParam(classId, "classId");

    await ensureDefaultClassRoles(classId);

    const rows = await dbGetAll("SELECT id, name, scopes, color FROM roles WHERE classId = ? ORDER BY id", [classId]);
    return rows.map((row) => buildRoleResponse(row));
}

async function findRoleByPermissionLevel(permissionLevel, classId = null) {
    if (classId != null) {
        await ensureDefaultClassRoles(classId);
    }

    const rows =
        classId == null
            ? await dbGetAll("SELECT id, name, classId, scopes, color FROM roles WHERE classId IS NULL ORDER BY id")
            : await dbGetAll("SELECT id, name, classId, scopes, color FROM roles WHERE classId = ? ORDER BY id", [classId]);

    const matcher = classId == null ? getGlobalRolePermissionLevel : getClassRolePermissionLevel;
    return rows.find((row) => matcher(row) === permissionLevel) || null;
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
async function createClassRole(classId, name, scopes, actingClassUser, classroom, color) {
    requireInternalParam(classId, "classId");

    await ensureDefaultClassRoles(classId);

    validateRoleName(name);
    validateScopes(scopes);
    validateNoPrivilegeEscalation(scopes, actingClassUser, classroom);

    // Check name doesn't conflict with existing roles in this class
    const existing = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [name, classId]);
    if (existing) {
        throw new ValidationError(`A role named "${name}" already exists in this class.`);
    }

    const roleColor = color !== undefined ? color : "#808080";
    const scopesJson = JSON.stringify(scopes);
    const id = await dbRun("INSERT INTO roles (name, classId, scopes, color) VALUES (?, ?, ?, ?)", [name, classId, scopesJson, roleColor]);

    // Update in-memory role caches
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        if (!classroomObj.customRoles) classroomObj.customRoles = {};
        classroomObj.customRoles[id] = [...scopes];
        if (!Array.isArray(classroomObj.availableRoles)) classroomObj.availableRoles = [];
        classroomObj.availableRoles.push(buildRoleResponse({ id, name, scopes, color: roleColor }));
    }

    return { id, name, scopes, color: roleColor };
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

    await ensureDefaultClassRoles(classId);

    const role = await dbGet("SELECT * FROM roles WHERE id = ? AND classId = ?", [roleId, classId]);
    if (!role) {
        throw new NotFoundError("Role not found in this class.");
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
        // Check for conflicts with other roles
        if (newName !== oldName) {
            const conflict = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ? AND id != ?", [newName, classId, roleId]);
            if (conflict) {
                throw new ValidationError(`A role named "${newName}" already exists in this class.`);
            }
        }
    }

    const newColor = updates.color !== undefined ? updates.color : role.color || "#808080";

    if (updates.scopes !== undefined) {
        validateScopes(newScopes);
        validateNoPrivilegeEscalation(newScopes, actingClassUser, classroom);
    }

    const scopesJson = JSON.stringify(newScopes);
    await dbRun("UPDATE roles SET name = ?, scopes = ?, color = ? WHERE id = ?", [newName, scopesJson, newColor, roleId]);

    // Update in-memory role caches
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj && classroomObj.customRoles) {
        classroomObj.customRoles[roleId] = [...newScopes];
    }

    if (classroomObj && Array.isArray(classroomObj.availableRoles)) {
        const availableRole = classroomObj.availableRoles.find((available) => Number(available.id) === Number(roleId));
        if (availableRole) {
            availableRole.name = newName;
            availableRole.scopes = [...newScopes];
            availableRole.color = newColor;
        }
    }

    // If the role was renamed, update students who have the old role name
    if (oldName !== newName) {
        if (classroomObj) {
            for (const student of Object.values(classroomObj.students)) {
                // Update multi-role array
                if (Array.isArray(student.classRoles)) {
                    const idx = student.classRoles.indexOf(oldName);
                    if (idx !== -1) {
                        student.classRoles[idx] = newName;
                    }
                }
                if (Array.isArray(student.classRoleRefs)) {
                    const roleRef = student.classRoleRefs.find((assignedRole) => Number(assignedRole.id) === Number(roleId));
                    if (roleRef) {
                        roleRef.name = newName;
                    }
                }
                student.classRole = computePrimaryRole(student.classRoleRefs || student.classRoles || [], classroomObj.availableRoles || []);
            }
        }
    }

    return { id: roleId, name: newName, scopes: newScopes, color: newColor };
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

    await ensureDefaultClassRoles(classId);

    const role = await dbGet("SELECT * FROM roles WHERE id = ? AND classId = ?", [roleId, classId]);
    if (!role) {
        throw new NotFoundError("Role not found in this class.");
    }

    // Find users affected by this role deletion before removing assignments
    const affectedUsers = await dbGetAll("SELECT DISTINCT ur.userId FROM user_roles ur WHERE ur.roleId = ? AND ur.classId = ?", [roleId, classId]);

    // Remove role assignments from user_roles
    await dbRun("DELETE FROM user_roles WHERE roleId = ? AND classId = ?", [roleId, classId]);

    // Delete the role
    await dbRun("DELETE FROM roles WHERE id = ?", [roleId]);

    // Recompute primary role for each affected user from their remaining roles
    for (const user of affectedUsers) {
        const remainingRoles = await dbGetAll(
            "SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.userId = ? AND ur.classId = ?",
            [user.userId, classId]
        );
    }

    // Update in-memory state
    const classroom = classStateStore.getClassroom(classId);
    if (classroom) {
        if (classroom.customRoles) {
            delete classroom.customRoles[roleId];
        }
        if (Array.isArray(classroom.availableRoles)) {
            classroom.availableRoles = classroom.availableRoles.filter((availableRole) => Number(availableRole.id) !== Number(roleId));
        }
        for (const student of Object.values(classroom.students)) {
            // Remove from multi-role array
            if (Array.isArray(student.classRoles)) {
                const idx = student.classRoles.indexOf(role.name);
                if (idx !== -1) {
                    student.classRoles.splice(idx, 1);
                }
            }
            if (Array.isArray(student.classRoleRefs)) {
                student.classRoleRefs = student.classRoleRefs.filter((assignedRole) => Number(assignedRole.id) !== Number(roleId));
            }
            student.classRole = computePrimaryRole(student.classRoleRefs || student.classRoles || [], classroom.availableRoles || []);
        }
    }
}

/**
 * Adds a role to a student within a class (multi-role).
 * Inserts into user_roles and updates in-memory state.
 * @param {string|number} classId
 * @param {number} userId
 * @param {number|string} roleId
 * @param {Object} [actingClassUser] - The class user performing the action (for privilege escalation check)
 * @param {Object} [classroom] - The classroom object
 * @returns {Promise<void>}
 */
async function addStudentRole(classId, userId, roleId, actingClassUser, classroom) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");
    requireInternalParam(roleId, "roleId");

    const role = await getRoleByIdForClass(classId, roleId);
    if (!role) {
        throw new ValidationError(`Role "${roleId}" does not exist in this class.`);
    }
    if (isImplicitGuestRole(role)) {
        throw new ValidationError("The implicit member role cannot be assigned explicitly.");
    }

    // Privilege escalation check
    if (actingClassUser && classroom) {
        validateNoPrivilegeEscalationForRole(role, actingClassUser, classroom);
    }

    // Verify user is in the class
    const classUser = await dbGet("SELECT * FROM classusers WHERE classId = ? AND studentId = ?", [classId, userId]);
    if (!classUser) {
        throw new NotFoundError("User is not a member of this class.");
    }

    // Check if already assigned
    const existing = await dbGet("SELECT 1 FROM user_roles WHERE userId = ? AND roleId = ? AND classId = ?", [userId, role.id, classId]);
    if (existing) {
        throw new ValidationError(`User already has the "${role.name}" role.`);
    }

    // Insert into user_roles
    await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, role.id, classId]);

    // Update in-memory
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        const email = await getEmailForUserId(userId);
        if (email && classroomObj.students[email]) {
            const student = classroomObj.students[email];
            if (!Array.isArray(student.classRoles)) student.classRoles = [];
            if (!student.classRoles.includes(role.name)) {
                student.classRoles.push(role.name);
            }
            if (!Array.isArray(student.classRoleRefs)) student.classRoleRefs = [];
            if (!student.classRoleRefs.some((assignedRole) => Number(assignedRole.id) === Number(role.id))) {
                student.classRoleRefs.push(buildRoleReference(role));
            }
            student.classRole = computePrimaryRole(student.classRoleRefs, classroomObj.availableRoles || []);
        }
    }
}

/**
 * Removes a role from a student within a class (multi-role).
 * Deletes from user_roles and updates in-memory state.
 * @param {string|number} classId
 * @param {number} userId
 * @param {number|string} roleId
 * @returns {Promise<void>}
 */
async function removeStudentRole(classId, userId, roleId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");
    requireInternalParam(roleId, "roleId");

    const role = await getRoleByIdForClass(classId, roleId);
    if (!role) {
        throw new ValidationError(`Role "${roleId}" does not exist in this class.`);
    }
    if (isImplicitGuestRole(role)) {
        throw new ValidationError("The implicit member role cannot be removed explicitly.");
    }

    // Check the assignment exists
    const existing = await dbGet("SELECT 1 FROM user_roles WHERE userId = ? AND roleId = ? AND classId = ?", [userId, role.id, classId]);
    if (!existing) {
        throw new ValidationError(`User does not have the "${role.name}" role.`);
    }

    // Delete from user_roles
    await dbRun("DELETE FROM user_roles WHERE userId = ? AND roleId = ? AND classId = ?", [userId, role.id, classId]);

    // Update in-memory
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        const email = await getEmailForUserId(userId);
        if (email && classroomObj.students[email]) {
            const student = classroomObj.students[email];
            if (Array.isArray(student.classRoles)) {
                const idx = student.classRoles.indexOf(role.name);
                if (idx !== -1) student.classRoles.splice(idx, 1);
            }
            if (Array.isArray(student.classRoleRefs)) {
                student.classRoleRefs = student.classRoleRefs.filter((assignedRole) => Number(assignedRole.id) !== Number(role.id));
            }
            student.classRole = computePrimaryRole(student.classRoleRefs || student.classRoles || [], classroomObj.availableRoles || []);
        }
    }
}

async function getUserRoles(user) {
    requireInternalParam(userId);

    const roles = {
        global: [],
        class: [],
    };

    roles.global = await dbGetAll(`SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.classId IS NULL AND ur.userId = ?`, [userId]);

    const classId = user.activeClass;
    if (classId) {
        roles.class = await dbGetAll(`SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.classId = ? AND ur.userId = ?`, [
            classId,
            userId,
        ]);
    }

    return roles;
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

    const rows = await dbGetAll(`SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.classId = ? AND ur.userId = ?`,  [classId, userId] );
    return rows.map((r) => r.name);
}

/**
 * Gets all role objects assigned to a student in a class.
 * @param {string|number} classId
 * @param {number} userId
 * @returns {Promise<Array<{id: number, name: string, scopes: string[]}>>}
 */
async function getStudentRoleAssignments(classId, userId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");

    // ...existing code...
    const rows = await dbGetAll(
        `SELECT r.id, r.name, r.classId, r.scopes
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.classId = ? AND ur.userId = ?
         ORDER BY CASE WHEN r.classId IS NULL THEN 0 ELSE 1 END, r.id`,
        [classId, userId]
    );

    return rows.map((row) => buildRoleResponse(row));
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

    await ensureDefaultClassRoles(classId);

    // Validate role exists in this class
    const classRole = await dbGet("SELECT id FROM roles WHERE name = ? AND classId = ?", [roleName, classId]);
    if (!classRole && roleName !== ROLE_NAMES.GUEST) {
        throw new ValidationError(`Role "${roleName}" does not exist in this class.`);
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
        await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, classRole.id, classId]);
    }

    // Update in-memory
    const classroom = classStateStore.getClassroom(classId);
    if (classroom) {
        const email = await getEmailForUserId(userId);
        if (email && classroom.students[email]) {
            const student = classroom.students[email];
            student.classRoles = roleName === ROLE_NAMES.GUEST ? [] : [roleName];
            student.classRoleRefs = roleName === ROLE_NAMES.GUEST ? [] : buildRoleReferences([getAvailableRoleByName(classroom, roleName)]);
            student.classRole = roleName === ROLE_NAMES.GUEST ? null : roleName;
        }
    }
}

/**
 * Loads class-scoped roles for a class from the database.
 * @param {string|number} classId
 * @returns {Promise<Object<string, string[]>>} Map of role name to scopes array
 */
async function loadCustomRoles(classId) {
    await ensureDefaultClassRoles(classId);

    const rows = await dbGetAll("SELECT id, scopes FROM roles WHERE classId = ?", [classId]);
    const customRoles = {};
    for (const row of rows) {
        customRoles[row.id] = parseStoredScopes(row.scopes);
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
    const actorScopes = new Set(getUserScopes(actingClassUser, classroom).class);
    for (const scope of scopes) {
        if (!actorScopes.has(scope)) {
            throw new ForbiddenError(`Cannot grant scope "${scope}" — you do not have it yourself.`);
        }
    }
}

/**
 * Ensures the acting user isn't assigning a role whose scopes exceed their own.
 */
function validateNoPrivilegeEscalationForRole(role, actingClassUser, classroom) {
    const roleScopes = buildRoleResponse(role).scopes;

    const actorLevel = getActorLevel(actingClassUser, classroom);
    const roleLevel = computeClassPermissionLevel(roleScopes);
    if (roleLevel >= actorLevel) {
        throw new ForbiddenError(`Cannot assign the "${role.name}" role — it is at or above your level.`);
    }

    validateNoPrivilegeEscalation(roleScopes, actingClassUser, classroom);
}

/**
 * Determines the hierarchy level of the acting class user for privilege escalation checks.
 * @param {Object} classUser - The class user object.
 * @returns {number} The highest hierarchy level (0=Banned, 1=Guest, 2=Student, 3=Mod, 4=Teacher, 5=Manager).
 */
function getActorLevel(classUser, classroom) {
    if (!classUser) return GUEST_PERMISSIONS;
    return computeClassPermissionLevel(getUserScopes(classUser, classroom), {
        isOwner: Boolean(classUser.isClassOwner),
        globalScopes: classUser.globalRoles || [],
    }.class);
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
        return {
            id: reqUser.id,
            email: reqUser.email,
            globalRoles: reqUser.globalRoles || [],
            classRoles: [],
            classRoleRefs: [],
            classRole: null,
            isClassOwner: true,
        };
    }
    return null;
}

module.exports = {
    getUserRoles,
    getClassRoles,
    createClassRole,
    updateClassRole,
    deleteClassRole,
    addStudentRole,
    removeStudentRole,
    getStudentRoles,
    getStudentRoleAssignments,
    assignStudentRole,
    loadCustomRoles,
    getActingUser,
    findRoleByPermissionLevel,
    BUILT_IN_ROLE_NAMES,
    ensureDefaultClassRoles,
};
