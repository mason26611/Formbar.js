CREATE TABLE IF NOT EXISTS "roles" (
    "id"      INTEGER NOT NULL UNIQUE,
    "name"    TEXT NOT NULL UNIQUE,             -- e.g. 'Student', 'Teacher', 'Manager'
    "classId" INTEGER UNIQUE,                   -- NULL = global system role
    "scopes"  TEXT NOT NULL DEFAULT '[]',       -- JSON array of scope strings
    PRIMARY KEY ("id" AUTOINCREMENT)
);

-- Assigns a role to a user (globally or within a class)
CREATE TABLE IF NOT EXISTS "user_roles" (
    "userId"  INTEGER NOT NULL,
    "roleId"  INTEGER NOT NULL,
    "classId" INTEGER -- NULL = global role assignment
    PRIMARY KEY ("userId", "roleId", "classId")
);