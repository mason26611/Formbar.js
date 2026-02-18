-- 14_add_inventory.sql
-- This migration adds an inventory table to track user items.

CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    UNIQUE (user_id, item_id)
);