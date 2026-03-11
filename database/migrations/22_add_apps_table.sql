-- 22_add_apps_table.sql
-- This migration adds an apps table to store information about apps.

CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    ownder_user_id INTEGER NOT NULL,
    share_item_id INTEGER NOT NULL,
    pool_id INTEGER NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    api_secret TEXT NOT NULL
);