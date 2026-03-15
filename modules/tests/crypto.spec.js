// Use low salt rounds so bcrypt tests finish quickly
process.env.SALT_ROUNDS = "4";

const { hash, compare, sha256 } = require("@modules/crypto");

describe("hash()", () => {
    it("returns a bcrypt hash starting with $2b$", async () => {
        const result = await hash("password");
        expect(result).toMatch(/^\$2b\$/);
    });

    it("rejects when given a non-string", async () => {
        await expect(hash(123)).rejects.toThrow("Text to hash must be a string");
    });

    it("rejects when given an empty string", async () => {
        await expect(hash("")).rejects.toThrow("Text to hash must be provided");
    });
});

describe("compare()", () => {
    it("returns true for matching text and hash", async () => {
        const hashed = await hash("secret");
        const result = await compare("secret", hashed);
        expect(result).toBe(true);
    });

    it("returns false for non-matching text and hash", async () => {
        const hashed = await hash("secret");
        const result = await compare("wrong", hashed);
        expect(result).toBe(false);
    });

    it("rejects when text is not a string", async () => {
        await expect(compare(123, "hash")).rejects.toThrow("Both text and hash must be strings");
    });

    it("rejects when hash is not a string", async () => {
        await expect(compare("text", 456)).rejects.toThrow("Both text and hash must be strings");
    });
});

describe("sha256()", () => {
    it("returns a 64-character hex string", () => {
        const result = sha256("hello");
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic", () => {
        expect(sha256("test")).toBe(sha256("test"));
    });

    it("produces different hashes for different inputs", () => {
        expect(sha256("abc")).not.toBe(sha256("xyz"));
    });

    it("throws on non-string input", () => {
        expect(() => sha256(42)).toThrow("Input to sha256 must be a string");
    });

    it("throws on empty string", () => {
        expect(() => sha256("")).toThrow("Input to sha256 must not be empty");
    });
});
