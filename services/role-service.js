const { dbGetAll, dbGet, dbRun } = require("@modules/database");
const { classStateStore } = require("@services/classroom-service");
const { ROLES, ROLE_NAMES, DEFAULT_ROLE_COLORS, ROLE_TO_LEVEL } = require("@modules/roles");
const { computeClassPermissionLevel, computeGlobalPermissionLevel, filterScopesByDomain, GUEST_PERMISSIONS } = require("@modules/permissions");
const { getUserScopes, getAllClassScopes, getUserRoleName } = require("@modules/scope-resolver");
const { requireInternalParam } = require("@modules/error-wrapper");
const { buildRoleReference, buildRoleReferences } = require("@modules/role-reference");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

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

function ensureStudentRoleBuckets(student) {
    if (!student || typeof student !== "object") return;
    if (!student.roles || typeof student.roles !== "object" || Array.isArray(student.roles)) {
        student.roles = { global: [], class: [] };
    }
    if (!Array.isArray(student.roles.global)) student.roles.global = [];
    if (!Array.isArray(student.roles.class)) student.roles.class = [];
}

/**
 * Seeds class-scoped default roles when a class has no built-in defaults yet.
 * This enables default roles to be modified per class without touching global rows.
 * @param {string|number} classId
 * @returns {Promise<void>}
 */
async function ensureDefaultClassRoles(classId) {
    requireInternalParam(classId, "classId");

    await dbRun(
        `INSERT INTO class_roles (roleId, classId)
         SELECT r.id, ?
         FROM roles r
         WHERE r.isDefault = 1
           AND NOT EXISTS (
             SELECT 1
             FROM class_roles cr
             JOIN roles r2 ON r2.id = cr.roleId
             WHERE cr.classId = ?
               AND r2.name = r.name
           )`,
        [classId, classId]
    );
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
        scopes: filterScopesByDomain(role.scopes, "class"),
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
 * @returns {Promise<{id: number, name: string, scopes: string, color: string|null}|null>} Raw role row, where `scopes` is stored JSON.
 */
async function getRoleByIdForClass(classId, roleId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(roleId, "roleId");

    await ensureDefaultClassRoles(classId);

    const classRole = await dbGet(
        `SELECT r.id, r.name, r.scopes, r.color
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE r.id = ? AND cr.classId = ?`,
        [roleId, classId]
    );
    if (classRole) {
        return classRole;
    }

    // Backward compatibility for clients still sending legacy global role IDs.
    const globalRole = await dbGet(
        `SELECT r.id, r.name, r.scopes, r.color
         FROM roles r
         WHERE r.id = ?
                     AND r.isDefault = 1`,
        [roleId]
    );
    if (!globalRole) {
        return null;
    }

    const classRoles = await dbGetAll(
        `SELECT r.id, r.name, r.scopes, r.color
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE cr.classId = ?`,
        [classId]
    );
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

    const rows = await dbGetAll(
        `SELECT r.id, r.name, r.scopes, r.color
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE cr.classId = ?
         ORDER BY r.id`,
        [classId]
    );
    return rows.map((row) => buildRoleResponse(row));
}

async function findRoleByPermissionLevel(permissionLevel, classId = null) {
    if (classId != null) {
        await ensureDefaultClassRoles(classId);
    }

    const rows =
        classId == null
            ? await dbGetAll(
                  `SELECT r.id, r.name, r.scopes, r.color
                 FROM roles r
                 WHERE r.isDefault = 1
                 ORDER BY r.id`
              )
            : await dbGetAll(
                  `SELECT r.id, r.name, r.scopes, r.color
                 FROM roles r
                 JOIN class_roles cr ON cr.roleId = r.id
                 WHERE cr.classId = ?
                 ORDER BY r.id`,
                  [classId]
              );

    const matcher = classId == null ? getGlobalRolePermissionLevel : getClassRolePermissionLevel;
    return rows.find((row) => matcher(row) === permissionLevel) || null;
}

/**
 * Creates a custom role for a class.
 * @param {Object} params
 * @param {string|number} params.classId
 * @param {string} params.name
 * @param {string[]} params.scopes
 * @param {Object} params.actingClassUser - The class user creating the role (for privilege escalation check)
 * @param {Object} params.classroom - The classroom object
 * @param {string} params.color
 * @returns {Promise<{id: number, name: string, scopes: string[], color: string}>}
 */
async function createClassRole({ classId, name, scopes, actingClassUser, classroom, color }) {
    requireInternalParam(classId, "classId");

    await ensureDefaultClassRoles(classId);

    validateRoleName(name);
    validateScopes(scopes);
    validateNoPrivilegeEscalation(scopes, actingClassUser, classroom);

    // Check name doesn't conflict with existing roles in this class
    const existing = await dbGet(
        `SELECT r.id
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE r.name = ? AND cr.classId = ?`,
        [name, classId]
    );
    if (existing) {
        throw new ValidationError(`A role named "${name}" already exists in this class.`);
    }

    const roleColor = color !== undefined ? color : "#808080";
    const scopesJson = JSON.stringify(scopes);
    const id = await dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [name, scopesJson, roleColor]);
    await dbRun("INSERT INTO class_roles (roleId, classId) VALUES (?, ?)", [id, classId]);

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

    const role = await dbGet(
        `SELECT r.*
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE r.id = ? AND cr.classId = ?`,
        [roleId, classId]
    );
    if (!role) {
        throw new NotFoundError("Role not found in this class.");
    }
    const isDefault = role.isDefault === 1;

    const oldName = role.name;
    const newName = updates.name !== undefined ? updates.name : role.name;
    let newScopes;
    try {
        newScopes = updates.scopes !== undefined ? updates.scopes : JSON.parse(role.scopes);
    } catch {
        newScopes = [];
    }

    if (isDefault) {
        const validClassScopes = getValidClassScopes();
        newScopes = parseStoredScopes(newScopes).filter((scope) => validClassScopes.has(scope));
    }

    if (updates.name !== undefined) {
        validateRoleName(newName);
        // Check for conflicts with other roles
        if (newName !== oldName) {
            const conflict = await dbGet(
                `SELECT r.id
                 FROM roles r
                 JOIN class_roles cr ON cr.roleId = r.id
                 WHERE r.name = ? AND cr.classId = ? AND r.id != ?`,
                [newName, classId, roleId]
            );
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
    let newRoleId = roleId;
    if (isDefault) {
        // When updating a default role, create a class-specific copy and replace
        // the class association/assignments from the default role to the new role.
        newRoleId = await dbRun("INSERT INTO roles (name, scopes, color, isDefault) VALUES (?, ?, ?, 0)", [newName, scopesJson, newColor]);
        await dbRun("UPDATE class_roles SET roleId = ? WHERE roleId = ? AND classId = ?", [newRoleId, roleId, classId]);
        await dbRun(
            `UPDATE user_roles
             SET roleId = ?, classId = ?
             WHERE roleId = ?
               AND (
                    classId = ?
                    OR (
                        classId IS NULL
                        AND userId IN (SELECT studentId FROM classusers WHERE classId = ?)
                    )
               )`,
            [newRoleId, classId, roleId, classId, classId]
        );
    } else {
        await dbRun("UPDATE roles SET name = ?, scopes = ?, color = ? WHERE id = ?", [newName, scopesJson, newColor, roleId]);
    }

    // Update in-memory role caches
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj && classroomObj.customRoles) {
        classroomObj.customRoles[newRoleId] = [...newScopes];
    }

    if (classroomObj && Array.isArray(classroomObj.availableRoles)) {
        const availableRole = classroomObj.availableRoles.find((available) => Number(available.id) === Number(roleId));
        if (availableRole) {
            availableRole.id = newRoleId;
            availableRole.name = newName;
            availableRole.scopes = [...newScopes];
            availableRole.color = newColor;
        }
    }

    if (isDefault && classroomObj) {
        for (const student of Object.values(classroomObj.students)) {
            ensureStudentRoleBuckets(student);
            for (const roleRef of student.roles.class) {
                if (Number(roleRef.id) === Number(roleId)) {
                    roleRef.id = newRoleId;
                    roleRef.name = newName;
                }
            }
        }
    }

    // If the role was renamed, update students who have the old role name
    if (oldName !== newName) {
        if (classroomObj) {
            for (const student of Object.values(classroomObj.students)) {
                ensureStudentRoleBuckets(student);
                const roleRef = student.roles.class.find((assignedRole) => Number(assignedRole.id) === Number(newRoleId));
                if (roleRef) {
                    roleRef.name = newName;
                }
            }
        }
    }

    return { id: newRoleId, name: newName, scopes: newScopes, color: newColor };
}

/**
 * Deletes a role from a class.
 * - Default roles: removes only class association.
 * - Non-default roles: removes association and deletes role row.
 * @param {number} roleId
 * @param {string|number} classId
 * @returns {Promise<void>}
 */
async function deleteClassRole(roleId, classId) {
    requireInternalParam(roleId, "roleId");
    requireInternalParam(classId, "classId");

    await ensureDefaultClassRoles(classId);

    const role = await dbGet(
        `SELECT r.*
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE r.id = ? AND cr.classId = ?`,
        [roleId, classId]
    );
    if (!role) {
        throw new NotFoundError("Role not found in this class.");
    }

    // Find users affected by this role deletion before removing assignments
    const affectedUsers = await dbGetAll("SELECT DISTINCT ur.userId FROM user_roles ur WHERE ur.roleId = ? AND ur.classId = ?", [roleId, classId]);

    // Remove role assignments from user_roles
    await dbRun("DELETE FROM user_roles WHERE roleId = ? AND classId = ?", [roleId, classId]);

    // Delete association for this class.
    await dbRun("DELETE FROM class_roles WHERE roleId = ? AND classId = ?", [roleId, classId]);

    // Non-default roles are class-specific and should be removed entirely.
    if (role.isDefault !== 1) {
        await dbRun("DELETE FROM class_roles WHERE roleId = ?", [roleId]);
        await dbRun("DELETE FROM roles WHERE id = ?", [roleId]);
    }

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
            ensureStudentRoleBuckets(student);
            student.roles.class = student.roles.class.filter((assignedRole) => Number(assignedRole.id) !== Number(roleId));
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
    const legacyExisting = await dbGet(
        `SELECT 1
         FROM user_roles ur
         JOIN class_roles cr ON cr.roleId = ur.roleId
         WHERE ur.userId = ?
           AND ur.roleId = ?
           AND ur.classId IS NULL
           AND cr.classId = ?`,
        [userId, role.id, classId]
    );
    if (existing || legacyExisting) {
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
            ensureStudentRoleBuckets(student);
            if (!student.roles.class.some((assignedRole) => Number(assignedRole.id) === Number(role.id))) {
                student.roles.class.push(buildRoleReference(role));
            }
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
    const existing = await dbGet(
        `SELECT 1
         FROM user_roles ur
         WHERE ur.userId = ?
           AND ur.roleId = ?
           AND (
                ur.classId = ?
                OR (
                    ur.classId IS NULL
                    AND EXISTS (SELECT 1 FROM class_roles cr WHERE cr.roleId = ur.roleId AND cr.classId = ?)
                )
           )`,
        [userId, role.id, classId, classId]
    );
    if (!existing) {
        throw new ValidationError(`User does not have the "${role.name}" role.`);
    }

    // Delete from user_roles
    await dbRun(
        `DELETE FROM user_roles
         WHERE userId = ?
           AND roleId = ?
           AND (
                classId = ?
                OR (
                    classId IS NULL
                    AND EXISTS (SELECT 1 FROM class_roles cr WHERE cr.roleId = user_roles.roleId AND cr.classId = ?)
                )
           )`,
        [userId, role.id, classId, classId]
    );

    const classScopedRemaining = await dbGet(`SELECT 1 FROM user_roles ur WHERE ur.userId = ? AND ur.classId = ?`, [userId, classId]);
    let insertedStudentRole = null;
    if (!classScopedRemaining) {
        await ensureDefaultClassRoles(classId);
        const studentRole = await dbGet(
            `SELECT r.id, r.name, r.scopes, r.color
             FROM roles r
             JOIN class_roles cr ON cr.roleId = r.id
             WHERE cr.classId = ?
               AND r.name = ?`,
            [classId, ROLE_NAMES.STUDENT]
        );
        if (studentRole) {
            await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, studentRole.id, classId]);
            insertedStudentRole = studentRole;
        }
    }

    // Update in-memory
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        const email = await getEmailForUserId(userId);
        if (email && classroomObj.students[email]) {
            const student = classroomObj.students[email];
            ensureStudentRoleBuckets(student);
            student.roles.class = student.roles.class.filter((assignedRole) => Number(assignedRole.id) !== Number(role.id));
            if (insertedStudentRole) {
                if (!student.roles.class.some((assignedRole) => Number(assignedRole.id) === Number(insertedStudentRole.id))) {
                    student.roles.class.push(buildRoleReference(insertedStudentRole));
                }
            }
        }
    }
}

async function getUserRoles(userId) {
    requireInternalParam(userId);

    const { getUser } = require("@services/user-service");

    const user = await getUser(userId);
    const roles = {
        global: [],
        class: [],
    };

    // If the user is not found, return the default roles
    if (!user) {
        return roles;
    }

    roles.global = await dbGetAll(`SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.classId IS NULL AND ur.userId = ?`, [
        userId,
    ]);

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

    const rows = await dbGetAll(`SELECT r.name FROM user_roles ur JOIN roles r ON ur.roleId = r.id WHERE ur.classId = ? AND ur.userId = ?`, [
        classId,
        userId,
    ]);
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
        `SELECT r.id, r.name, r.scopes, r.color
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.userId = ?
           AND (
                ur.classId = ?
                OR (
                    ur.classId IS NULL
                    AND EXISTS (SELECT 1 FROM class_roles cr WHERE cr.roleId = ur.roleId AND cr.classId = ?)
                )
           )
         ORDER BY r.id`,
        [userId, classId, classId]
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
    const classRole = await dbGet(
        `SELECT r.id
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE r.name = ? AND cr.classId = ?`,
        [roleName, classId]
    );
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
            ensureStudentRoleBuckets(student);
            student.roles.class = roleName === ROLE_NAMES.GUEST ? [] : buildRoleReferences([getAvailableRoleByName(classroom, roleName)]);
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

    const rows = await dbGetAll(
        `SELECT r.id, r.scopes
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE cr.classId = ?`,
        [classId]
    );
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
    const userScopes = getUserScopes(actingClassUser, classroom);
    const actorScopes = new Set([...userScopes.global, ...userScopes.class]);
    const globalRoleName = getUserRoleName(actingClassUser);
    if (globalRoleName && ROLES[globalRoleName]?.global) {
        for (const scope of ROLES[globalRoleName].global) {
            actorScopes.add(scope);
        }
    }

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
    const roleLevel = ROLE_TO_LEVEL[role.name] !== undefined ? ROLE_TO_LEVEL[role.name] : computeClassPermissionLevel(roleScopes);
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
    const userScopes = getUserScopes(classUser, classroom);
    return computeClassPermissionLevel(userScopes.class, {
        isOwner: Boolean(classUser.isClassOwner),
        globalScopes: userScopes.global,
    });
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
            roles: { global: reqUser.roles?.global || [], class: [] },
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
