// 28_allow_null_api_key
// Allows null API keys to avoid wasting CPU compute on hashing when users are registered

ALTER TABLE users RENAME TO users_temp

CREATE TABLE users (
    id INTEGER NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT,
    API TEXT,
    secret TEXT NOT NULL UNIQUE,
    tags TEXT,
    digipogs INTEGER NOT NULL DEFAULT 0,
    pin TEXT,
    displayName TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id AUTOINCREMENT)
);