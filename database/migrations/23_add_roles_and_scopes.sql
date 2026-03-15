CREATE TABLE IF NOT EXISTS "roles" (
    "id"      INTEGER NOT NULL UNIQUE,
    "name"    TEXT NOT NULL,
    "classId" INTEGER,
    "scopes"  TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY ("id" AUTOINCREMENT),
    UNIQUE ("name", "classId")
);

CREATE TABLE IF NOT EXISTS "user_roles" (
    "userId"  INTEGER NOT NULL,
    "roleId"  INTEGER NOT NULL,
    "classId" INTEGER,
    PRIMARY KEY ("userId", "roleId", COALESCE("classId", -1))
);

-- Seed default global roles (classId = NULL means global)
INSERT OR IGNORE INTO "roles" ("name", "classId", "scopes") VALUES ('Banned', NULL, '[]');
INSERT OR IGNORE INTO "roles" ("name", "classId", "scopes") VALUES ('Guest', NULL, '["class.poll.read","class.digipogs.award"]');
INSERT OR IGNORE INTO "roles" ("name", "classId", "scopes") VALUES ('Student', NULL, '["class.poll.read","class.poll.vote","class.break.request","class.help.request","class.digipogs.award"]');
INSERT OR IGNORE INTO "roles" ("name", "classId", "scopes") VALUES ('Mod', NULL, '["class.poll.read","class.poll.vote","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.break.request","class.break.approve","class.help.request","class.help.approve","class.auxiliary.control","class.games.access","class.tags.manage","class.digipogs.award"]');
INSERT OR IGNORE INTO "roles" ("name", "classId", "scopes") VALUES ('Teacher', NULL, '["global.class.create","global.class.delete","global.digipogs.award","class.poll.read","class.poll.vote","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.students.read","class.students.kick","class.students.ban","class.students.perm_change","class.session.start","class.session.end","class.session.rename","class.session.settings","class.session.regenerate_code","class.break.request","class.break.approve","class.help.request","class.help.approve","class.timer.control","class.auxiliary.control","class.games.access","class.tags.manage","class.digipogs.award"]');
INSERT OR IGNORE INTO "roles" ("name", "classId", "scopes") VALUES ('Manager', NULL, '["global.system.admin","global.users.manage","global.class.create","global.class.delete","global.digipogs.award","class.poll.read","class.poll.vote","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.students.read","class.students.kick","class.students.ban","class.students.perm_change","class.session.start","class.session.end","class.session.rename","class.session.settings","class.session.regenerate_code","class.break.request","class.break.approve","class.help.request","class.help.approve","class.timer.control","class.auxiliary.control","class.games.access","class.tags.manage","class.digipogs.award"]');

-- Add role column to users table for quick global role lookup
ALTER TABLE "users" ADD COLUMN "role" TEXT;

-- Add classRole column to classusers table for class-specific roles
ALTER TABLE "classusers" ADD COLUMN "role" TEXT;

-- Backfill users.role from existing numeric permissions
UPDATE "users" SET "role" = 'Banned' WHERE "permissions" = 0;
UPDATE "users" SET "role" = 'Guest' WHERE "permissions" = 1;
UPDATE "users" SET "role" = 'Student' WHERE "permissions" = 2;
UPDATE "users" SET "role" = 'Mod' WHERE "permissions" = 3;
UPDATE "users" SET "role" = 'Teacher' WHERE "permissions" = 4;
UPDATE "users" SET "role" = 'Manager' WHERE "permissions" = 5;

-- Backfill classusers.role from existing numeric permissions
UPDATE "classusers" SET "role" = 'Banned' WHERE "permissions" = 0;
UPDATE "classusers" SET "role" = 'Guest' WHERE "permissions" = 1;
UPDATE "classusers" SET "role" = 'Student' WHERE "permissions" = 2;
UPDATE "classusers" SET "role" = 'Mod' WHERE "permissions" = 3;
UPDATE "classusers" SET "role" = 'Teacher' WHERE "permissions" = 4;
UPDATE "classusers" SET "role" = 'Manager' WHERE "permissions" = 5;