const { dbRun } = require("@modules/database");
const { hash } = require("@modules/crypto");
const crypto = require("crypto");
const { apiKeyCacheStore } = require("@stores/api-key-cache-store");

module.exports = {
    run(socket) {
        socket.on("refreshPin", async (data) => {
            try {
                // Log the request information
                const { newPin } = data;

                // Check if userId is null or undefined
                const userId = socket.request.session.userId;
                if (!userId) {
                    return socket.emit("error", "There was a server error try again.");
                } else if (!newPin || newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
                    // Validate the new PIN. Must be 4-6 digits, numeric only
                    return socket.emit("error", "Invalid PIN format. PIN must be 4-6 digits.");
                }

                // Hash the new PIN then store it in the database
                const hashedPin = await hash(String(newPin));
                await dbRun("UPDATE users SET pin = ? WHERE id = ?", [hashedPin, userId]);

                // Log the successful PIN update and emit success
                socket.emit("pinUpdated", { success: true });
            } catch (err) {
                socket.emit("error", "There was a server error try again.");
            }
        });
    },
};
