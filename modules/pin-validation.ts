/**
 * Validates that a PIN string meets format requirements (4-6 numeric digits).
 */
function isValidPin(pin: string | number | null | undefined): boolean {
    return !!pin && String(pin).length >= 4 && String(pin).length <= 6 && /^\d+$/.test(String(pin));
}

module.exports = { isValidPin };
