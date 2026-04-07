const ValidationError = require("@errors/validation-error");

// Allowed characters (5–20 chars total)
const PASSWORD_REGEX = /^[a-zA-Z0-9!@#$%^&*()_\-+=\{\}\[\]<>,.:;'" ~?\/\\|]+$/;
const MIN_LENGTH = 5;
const MAX_LENGTH = 20;

/**
 * Checks whether a password meets requirements.
 *
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
    if (typeof password !== "string") return false;

    const length = password.length;
    if (length < MIN_LENGTH || length > MAX_LENGTH) return false;

    return PASSWORD_REGEX.test(password);
}

/**
 * Ensures password validity or throws a ValidationError.
 *
 * @param {string} password
 * @param {Object} [options={}]
 * @param {string} [options.event]
 * @param {string} [options.reason]
 * @throws {ValidationError}
 */
function assertValidPassword(password, options = {}) {
    if (isValidPassword(password)) return true;

    const { event = "", reason = "invalid_password" } = options;

    throw new ValidationError("Password must be 5–20 characters long and contain only allowed characters.", { event, reason });
}

module.exports = {
    isValidPassword,
    assertValidPassword,
};
