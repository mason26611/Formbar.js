const { isValidPin } = require("@modules/pin-validation");

describe("isValidPin()", () => {
    it.each(["1234", "12345", "123456"])("accepts valid pin %s", (pin) => {
        expect(isValidPin(pin)).toBeTruthy();
    });

    it("accepts a number since it casts to string internally", () => {
        expect(isValidPin(1234)).toBeTruthy();
    });

    it("rejects a pin shorter than 4 digits", () => {
        expect(isValidPin("123")).toBeFalsy();
    });

    it("rejects a pin longer than 6 digits", () => {
        expect(isValidPin("1234567")).toBeFalsy();
    });

    it("rejects non-numeric characters", () => {
        expect(isValidPin("abcd")).toBeFalsy();
    });

    it("rejects an empty string", () => {
        expect(isValidPin("")).toBeFalsy();
    });

    it("rejects null", () => {
        expect(isValidPin(null)).toBeFalsy();
    });

    it("rejects undefined", () => {
        expect(isValidPin(undefined)).toBeFalsy();
    });
});
