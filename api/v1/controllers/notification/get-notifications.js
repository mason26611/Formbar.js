const {getNotificationsForUser} = require("@services/notification-service");
const {isAuthenticated} = require("@middleware/authentication");
const {AppError} = require("@errors/app-error");

module.exports = (router) => {
    router.get("/get-notifications", isAuthenticated, async (req, res) => {
        req.infoEvent("notifications.get.attempt", "User is attempting to fetch notifications");
        const notifications = await getNotificationsForUser(req.user.id);
        if (!notifications) {
            throw new AppError("Failed to fetch notifications", {event: "notifications.get.failed"});
        }
        res.json({
            success: true, 
            data: {notifications}
        });
    });
};