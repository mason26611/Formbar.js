const {getNotificationsForUser} = require("@services/notification-service");
const {isAuthenticated} = require("@middleware/authentication");
const {AppError} = require("@errors/app-error");
const NotFoundError = require("@errors/not-found-error");

module.exports = (router) => {
    router.get("/notifications/get-all-notifications", isAuthenticated, async (req, res) => {

        req.infoEvent("notifications.get.attempt", "User is attempting to fetch all their notifications");

        const notifications = await getNotificationsForUser(req.user.id);

        if (!notifications) {
            throw new AppError("Failed to fetch notifications", {event: "notifications.get.failed"});
        }

        res.json({
            success: true, 
            data: {notifications}
        });

    });

    router.get("/notification/get-notification/:id", isAuthenticated, async (req, res) => {

        const notificationId = req.params.id;

        if (!notificationId) {
            throw new ValidationError("Notification ID is required", {event: "notifications.get.failed", reason: "Notification ID not provided"});
        }

        req.infoEvent("notifications.get.attempt", "User is attempting to fetch a specific notification", {notificationId});

        const notification = await getNotificationById(notificationId);

        if (!notification) {
            throw new NotFoundError("Notification not found", {event: "notifications.get.failed", reason: "Notification not found"});
        }

        if (notification.userId !== req.user.id) {
            throw new NotFoundError("Notification not found", {event: "notifications.get.failed", reason: "Notification does not belong to user"});
        }

        res.json({
            success: true,
            data: {notification}
        });

    });
};