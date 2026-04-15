-- 24_add_role_order.sql
-- This migration adds a role_order column to the role table.
ALTER TABLE class_roles ADD COLUMN order_index INTEGER;

-- Set default order_index based on existing roles (e.g., Teacher = 0, Manager = 1, etc.)
UPDATE class_roles
SET order_index = CASE
    WHEN roleId = 6 THEN 0
    WHEN roleId = 5 THEN 1
    WHEN roleId = 4 THEN 2
    WHEN roleId = 3 THEN 3
    WHEN roleId = 2 THEN 4