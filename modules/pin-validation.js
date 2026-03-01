/**
 * Validates that a PIN string meets format requirements (4-6 numeric digits).
 * @param {string} pin
 * @returns {boolean}
 */
function isValidPin(pin) {
    return pin && String(pin).length >= 4 && String(pin).length <= 6 && /^\d+$/.test(String(pin));
}

module.exports = { isValidPin };
