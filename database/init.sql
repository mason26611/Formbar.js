-- ============================================================================
-- Formbar.js Database Schema (Version 1)
-- This file represents the complete, current database schema.
-- New databases are initialized from this file directly.
-- Existing databases are upgraded via migrate.js + 00_legacy_compact.js.
-- ============================================================================

-- Schema version tracking
CREATE TABLE IF NOT EXISTS "schema_version"
(
    "version" INTEGER NOT NULL
);

INSERT INTO "schema_version" ("version") VALUES (1);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "users"
(
    "id"          INTEGER NOT NULL UNIQUE,
    "email"       TEXT    NOT NULL UNIQUE,
    "password"    TEXT,
    "permissions" INTEGER,
    "role"        TEXT,
    "API"         TEXT    NOT NULL UNIQUE,
    "secret"      TEXT    NOT NULL UNIQUE,
    "tags"        TEXT,
    "digipogs"    INTEGER NOT NULL DEFAULT 0,
    "pin"         TEXT,
    "displayName" TEXT,
    "verified"    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_display_name_unique" ON "users" ("displayName");

-- ---------------------------------------------------------------------------
-- Classrooms
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "classroom"
(
    "id"       INTEGER NOT NULL UNIQUE,
    "name"     TEXT    NOT NULL,
    "owner"    INTEGER NOT NULL,
    "key"      INTEGER NOT NULL,
    "tags"     TEXT,
    "settings" TEXT,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "classusers"
(
    "classId"     INTEGER NOT NULL,
    "studentId"   INTEGER NOT NULL,
    "permissions" INTEGER,
    "tags"        TEXT,
    "role"        TEXT
);

CREATE TABLE IF NOT EXISTS "class_permissions"
(
    "classId"        INTEGER NOT NULL UNIQUE,
    "manageClass"    INTEGER NOT NULL DEFAULT 4,
    "manageStudents" INTEGER NOT NULL DEFAULT 4,
    "controlPoll"    INTEGER NOT NULL DEFAULT 3,
    "votePoll"       INTEGER NOT NULL DEFAULT 2,
    "seePoll"        INTEGER NOT NULL DEFAULT 1,
    "breakHelp"      INTEGER NOT NULL DEFAULT 3,
    "auxiliary"      INTEGER NOT NULL DEFAULT 3,
    "links"          INTEGER NOT NULL DEFAULT 3,
    "userDefaults"   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "links"
(
    "id"      INTEGER NOT NULL UNIQUE,
    "name"    TEXT    NOT NULL,
    "url"     TEXT    NOT NULL,
    "classId" INTEGER NOT NULL,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

-- ---------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "custom_polls"
(
    "id"                     INTEGER NOT NULL UNIQUE,
    "owner"                  TEXT,
    "name"                   TEXT,
    "prompt"                 TEXT,
    "answers"                TEXT    NOT NULL,
    "textRes"                INTEGER NOT NULL DEFAULT 0 CHECK ("textRes" IN (0, 1)),
    "blind"                  INTEGER NOT NULL DEFAULT 0 CHECK ("blind" IN (0, 1)),
    "allowVoteChanges"       INTEGER NOT NULL DEFAULT 1 CHECK ("allowVoteChanges" IN (0, 1)),
    "allowMultipleResponses" INTEGER NOT NULL DEFAULT 0 CHECK ("allowMultipleResponses" IN (0, 1)),
    "weight"                 INTEGER NOT NULL DEFAULT 1,
    "public"                 INTEGER NOT NULL DEFAULT 0 CHECK ("public" IN (0, 1)),
    PRIMARY KEY ("id" AUTOINCREMENT)
);

INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (1, NULL, 'TUTD', 'Thumbs?', '[{"answer":"Up","weight":0.9,"color":"#00FF00"},{"answer":"Wiggle","weight":1,"color":"#00FFFF"},{"answer":"Down","weight":1.1,"color":"#FF0000"}]', 0, 0, 1, 1, 1);
INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (2, NULL, 'True/False', 'True or False', '[{"answer":"True","weight":1,"color":"#00FF00"},{"answer":"False","weight":1,"color":"#FF0000"}]', 0, 0, 1, 1, 1);
INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (3, NULL, 'Done/Ready?', 'Done/Ready?', '[{"answer":"Yes","weight":1,"color":"#00FF00"}]', 0, 0, 1, 1, 1);
INSERT INTO "custom_polls" ("id", "owner", "name", "prompt", "answers", "textRes", "blind", "allowVoteChanges", "weight", "public") VALUES (4, NULL, 'Multiple Choice', 'Multiple Choice', '[{"answer":"A","weight":1,"color":"#FF0000"},{"answer":"B","weight":1,"color":"#0000FF"},{"answer":"C","weight":1,"color":"#FFFF00"},{"answer":"D","weight":1,"color":"#00FF00"}]', 0, 0, 1, 1, 1);

CREATE TABLE IF NOT EXISTS "class_polls"
(
    "pollId"  INTEGER NOT NULL,
    "classId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "shared_polls"
(
    "pollId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "poll_answers"
(
    "pollId"         INTEGER NOT NULL,
    "classId"        INTEGER NOT NULL,
    "userId"         INTEGER NOT NULL,
    "buttonResponse" TEXT,
    "textResponse"   TEXT,
    "createdAt"      INTEGER,
    PRIMARY KEY ("userId", "pollId")
);

CREATE TABLE IF NOT EXISTS "poll_history"
(
    "id"                     INTEGER NOT NULL UNIQUE,
    "class"                  INTEGER NOT NULL,
    "prompt"                 TEXT,
    "responses"              TEXT,
    "allowMultipleResponses" INTEGER NOT NULL DEFAULT 0,
    "blind"                  INTEGER NOT NULL DEFAULT 0,
    "allowTextResponses"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"              INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

-- ---------------------------------------------------------------------------
-- Authentication & Authorization
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "refresh_tokens"
(
    "user_id"    INTEGER NOT NULL,
    "token_hash" TEXT    NOT NULL UNIQUE,
    "exp"        INTEGER NOT NULL,
    "token_type" TEXT    NOT NULL DEFAULT 'auth'
);

CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_type" ON "refresh_tokens" ("token_type");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_type" ON "refresh_tokens" ("user_id", "token_type");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_refresh_token_hash_unique" ON "refresh_tokens" ("token_hash");

CREATE TABLE IF NOT EXISTS "used_authorization_codes"
(
    "code_hash"  TEXT    NOT NULL UNIQUE,
    "used_at"    INTEGER NOT NULL,
    "expires_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_used_auth_codes_expires" ON "used_authorization_codes" ("expires_at");

CREATE TABLE IF NOT EXISTS "temp_user_creation_data"
(
    "token"  TEXT NOT NULL UNIQUE,
    "secret" TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS "roles"
(
    "id"      INTEGER NOT NULL UNIQUE,
    "name"    TEXT    NOT NULL,
    "classId" INTEGER,
    "scopes"  TEXT    NOT NULL DEFAULT '[]',
    PRIMARY KEY ("id" AUTOINCREMENT),
    UNIQUE ("name", "classId")
);

CREATE TABLE IF NOT EXISTS "user_roles"
(
    "userId"  INTEGER NOT NULL,
    "roleId"  INTEGER NOT NULL,
    "classId" INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_roles_unique" ON "user_roles" ("userId", "roleId", COALESCE("classId", -1));

INSERT INTO "roles" ("name", "classId", "scopes") VALUES ('Banned', NULL, '[]');
INSERT INTO "roles" ("name", "classId", "scopes") VALUES ('Guest', NULL, '["class.poll.read","class.links.read"]');
INSERT INTO "roles" ("name", "classId", "scopes") VALUES ('Student', NULL, '["global.pools.manage","global.digipogs.transfer","class.poll.read","class.poll.vote","class.break.request","class.help.request","class.links.read"]');
INSERT INTO "roles" ("name", "classId", "scopes") VALUES ('Mod', NULL, '["global.pools.manage","global.digipogs.transfer","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.break.approve","class.help.approve","class.auxiliary.control","class.games.access","class.tags.manage","class.links.manage","class.poll.read","class.poll.vote","class.break.request","class.help.request","class.links.read"]');
INSERT INTO "roles" ("name", "classId", "scopes") VALUES ('Teacher', NULL, '["global.class.create","global.class.delete","global.digipogs.award","global.pools.manage","global.digipogs.transfer","class.students.read","class.students.kick","class.students.ban","class.students.perm_change","class.session.start","class.session.end","class.session.rename","class.session.settings","class.session.regenerate_code","class.timer.control","class.digipogs.award","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.break.approve","class.help.approve","class.auxiliary.control","class.games.access","class.tags.manage","class.links.manage","class.poll.read","class.poll.vote","class.break.request","class.help.request","class.links.read"]');
INSERT INTO "roles" ("name", "classId", "scopes") VALUES ('Manager', NULL, '["global.system.admin","global.users.manage","global.class.create","global.class.delete","global.digipogs.award","global.pools.manage","global.digipogs.transfer","class.students.read","class.students.kick","class.students.ban","class.students.perm_change","class.session.start","class.session.end","class.session.rename","class.session.settings","class.session.regenerate_code","class.timer.control","class.digipogs.award","class.poll.create","class.poll.end","class.poll.delete","class.poll.share","class.break.approve","class.help.approve","class.auxiliary.control","class.games.access","class.tags.manage","class.links.manage","class.poll.read","class.poll.vote","class.break.request","class.help.request","class.links.read"]');

-- ---------------------------------------------------------------------------
-- Digipogs & Economy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "transactions"
(
    "from_id"   INTEGER NOT NULL,
    "to_id"     INTEGER NOT NULL,
    "from_type" TEXT    NOT NULL,
    "to_type"   TEXT    NOT NULL,
    "amount"    INTEGER NOT NULL,
    "reason"    TEXT    NOT NULL DEFAULT 'None',
    "date"      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS "digipog_pools"
(
    "id"          INTEGER NOT NULL UNIQUE,
    "name"        TEXT    NOT NULL,
    "description" TEXT    NOT NULL DEFAULT 'None',
    "amount"      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "digipog_pool_users"
(
    "pool_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "owner"   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("pool_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "inventory"
(
    "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
    "user_id"  INTEGER NOT NULL,
    "item_id"  INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
    UNIQUE ("user_id", "item_id")
);

CREATE TABLE IF NOT EXISTS "item_registry"
(
    "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
    "name"        TEXT    NOT NULL,
    "description" TEXT,
    "stack_size"  INTEGER NOT NULL DEFAULT 1 CHECK ("stack_size" >= 0),
    "image_url"   TEXT
);

CREATE TABLE IF NOT EXISTS "trades"
(
    "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
    "from_user"       INTEGER NOT NULL,
    "to_user"         INTEGER NOT NULL,
    "offered_items"   TEXT    NOT NULL,
    "requested_items" TEXT    NOT NULL,
    "status"          TEXT    NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'accepted', 'rejected')),
    "created_at"      TEXT    NOT NULL,
    "updated_at"      TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Networking & Apps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ip_access_list"
(
    "id"           INTEGER NOT NULL UNIQUE,
    "ip"           TEXT    NOT NULL,
    "is_whitelist" INTEGER NOT NULL CHECK ("is_whitelist" IN (0, 1)),
    PRIMARY KEY ("id" AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS "apps"
(
    "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
    "name"            TEXT    NOT NULL UNIQUE,
    "description"     TEXT,
    "owner_user_id"   INTEGER NOT NULL,
    "share_item_id"   INTEGER NOT NULL,
    "pool_id"         INTEGER NOT NULL,
    "api_key_hash"    TEXT    NOT NULL UNIQUE,
    "api_secret_hash" TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "notifications"
(
    "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
    "user_id"    INTEGER NOT NULL,
    "type"       TEXT    NOT NULL,
    "data"       TEXT,
    "is_read"    INTEGER NOT NULL DEFAULT 0 CHECK ("is_read" IN (0, 1)),
    "created_at" TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" ("user_id");