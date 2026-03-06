-- 22_add_companies_table.sql
-- This migration adds a companies table to store information about companies.

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_item_id INTEGER NOT NULL,
    pool_id INTEGER NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    api_secret TEXT NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    logo_url TEXT
);