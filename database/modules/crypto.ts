// Main branch crypto module
// Used for decrypting passwords from pre-v1 database and hashing them
import crypto = require("crypto");

const algorithm = "aes-256-ctr";
const secretKey = "vOVH6sdmpNWjRRIqCc7rdxs01lwHzfr3";

interface EncryptedHash {
    iv: string;
    content: string;
}

const decrypt = (hash: EncryptedHash): string => {
    const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(hash.iv, "hex"));

    const decrpyted = Buffer.concat([decipher.update(Buffer.from(hash.content, "hex")), decipher.final()]);

    return decrpyted.toString();
};

module.exports = {
    decrypt,
};
