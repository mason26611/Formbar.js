-- 16_add_trades.sql
-- This migration adds an trades table to store information about trades between users.

CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER NOT NULL,
    to_user INTEGER NOT NULL,
    offered_items TEXT NOT NULL,
    requested_items TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);