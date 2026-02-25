-- 15_add_item_registry_table.sql
-- This migration adds an item registry table to store information about items that can be in user inventories.

CREATE TABLE item_registry (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    stack_size INTEGER NOT NULL DEFAULT 1 CHECK (stack_size > 0),
    image_url TEXT
);