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

function ensureStudentRoleBuckets(student) {
    if (!student || typeof student !== "object") return;
    if (!student.roles || typeof student.roles !== "object" || Array.isArray(student.roles)) {
        student.roles = { global: [], class: [] };
    }
    if (!Array.isArray(student.roles.global)) student.roles.global = [];
    if (!Array.isArray(student.roles.class)) student.roles.class = [];
}

function sortAvailableRoles(roles) {
    if (!Array.isArray(roles)) {
        return;
    }

    roles.sort((left, right) => {
        const leftOrder = left?.orderIndex ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right?.orderIndex ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || Number(left?.id || 0) - Number(right?.id || 0);
    });
}

/**
 * Seeds class-scoped default roles the first time a class needs them.
 * This enables default roles to be modified per class without touching global rows.
 * @param {string|number} classId
 * @returns {Promise<void>}
 */
async function addDefaultClassRoles(classId) {
    requireInternalParam(classId, "classId");

    const existingClassRoles = await dbGet("SELECT 1 FROM class_roles WHERE classId = ? LIMIT 1", [classId]);
    if (!existingClassRoles) {
        await dbRun(
            `INSERT OR IGNORE INTO class_roles (roleId, classId)
             SELECT id, ?
             FROM roles
             WHERE isDefault = 1`,
            [classId]
        );
    }

    await dbRun(
        `UPDATE class_roles
         SET orderIndex = CASE
             WHEN roleId = 6 THEN 0
             WHEN roleId = 5 THEN 1
             WHEN roleId = 4 THEN 2
             WHEN roleId = 3 THEN 3
             WHEN roleId = 2 THEN 4
             ELSE NULL
         END
         WHERE classId = ?
           AND orderIndex IS NULL`,
        [classId]
    );
}

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
 * @param {{id: number, name: string, scopes?: string|string[], color?: string, orderIndex?: number|null}} role
 * @returns {{id: number, name: string, scopes: string[], color: string, orderIndex: number|null}}
 */
function buildRoleResponse(role) {
    return {
        id: role.id,
        name: role.name,
        scopes: filterScopesByDomain(role.scopes, "class"),
        color: role.color || DEFAULT_ROLE_COLORS[role.name] || "#808080",
        orderIndex: role.orderIndex ?? null,
    };
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
 * @returns {Promise<{id: number, name: string, scopes: string, color: string|null, orderIndex?: number|null}|null>}
 */
async function getRoleByIdForClass(classId, roleId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(roleId, "roleId");

    await addDefaultClassRoles(classId);

    const classRole = await dbGet(
        `SELECT r.id, r.name, r.scopes, r.color, cr.orderIndex
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE r.id = ? AND cr.classId = ?`,
        [roleId, classId]
    );
    if (classRole) {
        return classRole;
    }

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
        `SELECT r.id, r.name, r.scopes, r.color, cr.orderIndex
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
 * @returns {Promise<Array<{id: number, name: string, scopes: string[], color: string, orderIndex: number|null}>>}
 */
async function getClassRoles(classId) {
    requireInternalParam(classId, "classId");

    await addDefaultClassRoles(classId);

    const rows = await dbGetAll(
        `SELECT r.id, r.name, r.scopes, r.color, cr.orderIndex
         FROM roles r
         JOIN class_roles cr ON cr.roleId = r.id
         WHERE cr.classId = ?
         ORDER BY cr.orderIndex, r.id`,
        [classId]
    );
    return rows.map((row) => buildRoleResponse(row));
}

async function findRoleByPermissionLevel(permissionLevel, classId = null) {
    if (classId != null) {
        await addDefaultClassRoles(classId);
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
                  `SELECT r.id, r.name, r.scopes, r.color, cr.orderIndex
                   FROM roles r
                   JOIN class_roles cr ON cr.roleId = r.id
                   WHERE cr.classId = ?
                   ORDER BY cr.orderIndex, r.id`,
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
 * @param {Object} params.actingClassUser
 * @param {Object} params.classroom
 * @param {string} params.color
 * @returns {Promise<{id: number, name: string, scopes: string[], color: string}>}
 */
async function createClassRole({ classId, name, scopes, actingClassUser, classroom, color }) {
    requireInternalParam(classId, "classId");

    await addDefaultClassRoles(classId);

    validateRoleName(name);
    validateScopes(scopes);
    validateNoPrivilegeEscalation(scopes, actingClassUser, classroom);

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
    const lastOrderIndex = await dbGet("SELECT MAX(orderIndex) AS maxOrder FROM class_roles WHERE classId = ?", [classId]);
    const newOrderIndex = (lastOrderIndex?.maxOrder ?? -1) + 1;
    await dbRun("INSERT INTO class_roles (roleId, classId, orderIndex) VALUES (?, ?, ?)", [id, classId, newOrderIndex]);

    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        if (!classroomObj.customRoles) classroomObj.customRoles = {};
        classroomObj.customRoles[id] = [...scopes];
        if (!Array.isArray(classroomObj.availableRoles)) classroomObj.availableRoles = [];
        classroomObj.availableRoles.push(buildRoleResponse({ id, name, scopes, color: roleColor, orderIndex: newOrderIndex }));
        sortAvailableRoles(classroomObj.availableRoles);
    }

    return { id, name, scopes, color: roleColor };
}

/**
 * Updates a role for a class.
 * @param {Object} params
 * @param {number|string} params.roleId
 * @param {string|number} params.classId
 * @param {{name?: string, scopes?: string[], color?: string, orderIndex?: number}} params.updates
 * @param {Object} params.actingClassUser
 * @param {Object} params.classroom
 * @returns {Promise<{id: number, name: string, scopes: string[], color: string}>}
 */
async function updateClassRole({ roleId, classId, updates, actingClassUser, classroom }) {
    requireInternalParam(roleId, "roleId");
    requireInternalParam(classId, "classId");

    await addDefaultClassRoles(classId);

    const role = await dbGet(
        `SELECT r.*, cr.orderIndex
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

    const newOrderIndex = updates.orderIndex;
    if (newOrderIndex !== undefined && (!Number.isInteger(newOrderIndex) || newOrderIndex < 0)) {
        throw new ValidationError("orderIndex must be a non-negative integer.");
    }

    const scopesJson = JSON.stringify(newScopes);
    let newRoleId = Number(roleId);
    if (isDefault) {
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

    if (newOrderIndex !== undefined) {
        await dbRun("UPDATE class_roles SET orderIndex = ? WHERE roleId = ? AND classId = ?", [newOrderIndex, newRoleId, classId]);
    }

    const effectiveOrderIndex = newOrderIndex !== undefined ? newOrderIndex : role.orderIndex ?? null;
    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        if (classroomObj.customRoles) {
            if (newRoleId !== Number(roleId)) {
                delete classroomObj.customRoles[roleId];
            }
            classroomObj.customRoles[newRoleId] = [...newScopes];
        }

        if (Array.isArray(classroomObj.availableRoles)) {
            const availableRole = classroomObj.availableRoles.find((available) => Number(available.id) === Number(roleId));
            if (availableRole) {
                availableRole.id = newRoleId;
                availableRole.name = newName;
                availableRole.scopes = [...newScopes];
                availableRole.color = newColor;
                availableRole.orderIndex = effectiveOrderIndex;
            }
            sortAvailableRoles(classroomObj.availableRoles);
        }

        for (const student of Object.values(classroomObj.students || {})) {
            ensureStudentRoleBuckets(student);
            for (const roleRef of student.roles.class) {
                if (Number(roleRef.id) === Number(roleId)) {
                    roleRef.id = newRoleId;
                    roleRef.name = newName;
                }
            }
        }
    }

    return { id: newRoleId, name: newName, scopes: newScopes, color: newColor };
}

/**
 * Deletes a role from a class.
 * @param {number|string} roleId
 * @param {string|number} classId
 * @returns {Promise<void>}
 */
async function deleteClassRole(roleId, classId) {
    requireInternalParam(roleId, "roleId");
    requireInternalParam(classId, "classId");

    await addDefaultClassRoles(classId);

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

    await dbRun("DELETE FROM user_roles WHERE roleId = ? AND classId = ?", [roleId, classId]);
    await dbRun("DELETE FROM class_roles WHERE roleId = ? AND classId = ?", [roleId, classId]);

    if (role.isDefault !== 1) {
        await dbRun("DELETE FROM class_roles WHERE roleId = ?", [roleId]);
        await dbRun("DELETE FROM roles WHERE id = ?", [roleId]);
    }

    const classroom = classStateStore.getClassroom(classId);
    if (!classroom) {
        return;
    }

    if (classroom.customRoles) {
        delete classroom.customRoles[roleId];
    }
    if (Array.isArray(classroom.availableRoles)) {
        classroom.availableRoles = classroom.availableRoles.filter((availableRole) => Number(availableRole.id) !== Number(roleId));
    }
    for (const student of Object.values(classroom.students || {})) {
        ensureStudentRoleBuckets(student);
        student.roles.class = student.roles.class.filter((assignedRole) => Number(assignedRole.id) !== Number(roleId));
    }
}

/**
 * Adds a role to a student within a class.
 * @param {string|number} classId
 * @param {number} userId
 * @param {number|string} roleId
 * @param {Object} [actingClassUser]
 * @param {Object} [classroom]
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

    if (actingClassUser && classroom) {
        validateNoPrivilegeEscalationForRole(role, actingClassUser, classroom);
    }

    const classUser = await dbGet("SELECT 1 FROM classusers WHERE classId = ? AND studentId = ?", [classId, userId]);
    if (!classUser) {
        throw new NotFoundError("User is not a member of this class.");
    }

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

    await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, role.id, classId]);

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
 * Removes a role from a student within a class.
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

    const classScopedRemaining = await dbGet("SELECT 1 FROM user_roles WHERE userId = ? AND classId = ?", [userId, classId]);
    let insertedStudentRole = null;
    if (!classScopedRemaining) {
        await addDefaultClassRoles(classId);
        const studentRole = await dbGet(
            `SELECT r.id, r.name, r.scopes, r.color, cr.orderIndex
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

    const classroomObj = classStateStore.getClassroom(classId);
    if (classroomObj) {
        const email = await getEmailForUserId(userId);
        if (email && classroomObj.students[email]) {
            const student = classroomObj.students[email];
            ensureStudentRoleBuckets(student);
            student.roles.class = student.roles.class.filter((assignedRole) => Number(assignedRole.id) !== Number(role.id));
            if (insertedStudentRole && !student.roles.class.some((assignedRole) => Number(assignedRole.id) === Number(insertedStudentRole.id))) {
                student.roles.class.push(buildRoleReference(insertedStudentRole));
            }
        }
    }
}

async function getUserRoles(userId) {
    requireInternalParam(userId, "userId");

    const roles = {
        global: [],
        class: [],
    };

    const email = await getEmailForUserId(userId);
    if (!email) {
        return roles;
    }

    const globalRoleRows = await dbGetAll(
        `SELECT r.id, r.name, r.scopes, r.color
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.classId IS NULL
           AND ur.userId = ?`,
        [userId]
    );
    roles.global = globalRoleRows.filter((role) => filterScopesByDomain(role.scopes, "global").length > 0);

    let classId = null;
    for (const classroom of Object.values(classStateStore.getAllClassrooms())) {
        if (classroom?.students?.[email]) {
            classId = classroom.id ?? classroom.classId;
            break;
        }
    }

    if (classId) {
        const classRoleRows = await dbGetAll(
            `SELECT DISTINCT r.id, r.name, r.scopes, r.color
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
        roles.class = classRoleRows.filter((role) => filterScopesByDomain(role.scopes, "class").length > 0);
    }

    return roles;
}

/**
 * Gets all role names assigned to a student in a class.
 * @param {string|number} classId
 * @param {number} userId
 * @returns {Promise<string[]>}
 */
async function getStudentRoles(classId, userId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");

    const rows = await dbGetAll(
        `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         WHERE ur.classId = ?
           AND ur.userId = ?`,
        [classId, userId]
    );
    return rows.map((row) => row.name);
}

/**
 * Gets all role objects assigned to a student in a class.
 * @param {string|number} classId
 * @param {number} userId
 * @returns {Promise<Array<{id: number, name: string, scopes: string[], color: string, orderIndex: number|null}>>}
 */
async function getStudentRoleAssignments(classId, userId) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");

    const rows = await dbGetAll(
        `SELECT r.id, r.name, r.scopes, r.color, cr.orderIndex
         FROM user_roles ur
         JOIN roles r ON ur.roleId = r.id
         LEFT JOIN class_roles cr ON cr.roleId = r.id AND cr.classId = ?
         WHERE ur.userId = ?
           AND (
                ur.classId = ?
                OR (
                    ur.classId IS NULL
                    AND EXISTS (SELECT 1 FROM class_roles cr2 WHERE cr2.roleId = ur.roleId AND cr2.classId = ?)
                )
           )
         ORDER BY r.id`,
        [classId, userId, classId, classId]
    );

    return rows.map((row) => buildRoleResponse(row));
}

/**
 * Assigns a single role to a student, replacing all existing roles.
 * @param {string|number} classId
 * @param {number} userId
 * @param {string} roleName
 * @returns {Promise<void>}
 */
async function assignStudentRole(classId, userId, roleName) {
    requireInternalParam(classId, "classId");
    requireInternalParam(userId, "userId");
    requireInternalParam(roleName, "roleName");

    await addDefaultClassRoles(classId);

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

    const classUser = await dbGet("SELECT 1 FROM classusers WHERE classId = ? AND studentId = ?", [classId, userId]);
    if (!classUser) {
        throw new NotFoundError("User is not a member of this class.");
    }

    await dbRun("DELETE FROM user_roles WHERE userId = ? AND classId = ?", [userId, classId]);

    if (roleName !== ROLE_NAMES.GUEST) {
        await dbRun("INSERT INTO user_roles (userId, roleId, classId) VALUES (?, ?, ?)", [userId, classRole.id, classId]);
    }

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
 * @returns {Promise<Object<string, string[]>>}
 */
async function loadCustomRoles(classId) {
    await addDefaultClassRoles(classId);

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

function validateNoPrivilegeEscalationForRole(role, actingClassUser, classroom) {
    const roleScopes = buildRoleResponse(role).scopes;
    const actorLevel = getActorLevel(actingClassUser, classroom);
    const roleLevel = ROLE_TO_LEVEL[role.name] !== undefined ? ROLE_TO_LEVEL[role.name] : computeClassPermissionLevel(roleScopes);
    if (roleLevel >= actorLevel) {
        throw new ForbiddenError(`Cannot assign the "${role.name}" role — it is at or above your level.`);
    }

    validateNoPrivilegeEscalation(roleScopes, actingClassUser, classroom);
}

function getActorLevel(classUser, classroom) {
    if (!classUser) return GUEST_PERMISSIONS;
    const userScopes = getUserScopes(classUser, classroom);
    return computeClassPermissionLevel(userScopes.class, {
        isOwner: Boolean(classUser.isClassOwner),
        globalScopes: userScopes.global,
    });
}

async function getEmailForUserId(userId) {
    const row = await dbGet("SELECT email FROM users WHERE id = ?", [userId]);
    return row ? row.email : null;
}

function getActingUser(classroom, reqUser) {
    if (!classroom) return null;
    const student = classroom.students?.[reqUser.email];
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
    addDefaultClassRoles,
    ensureDefaultClassRoles: addDefaultClassRoles,
};
