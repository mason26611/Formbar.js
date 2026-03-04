const {getNotificationById, markNotificationAsRead} = require("@services/notification-service");
const {isAuthenticated} = require("@middleware/authentication");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {

    router.post("/notifications/mark-notification-as-read/:id", isAuthenticated, async (req, res) => {

        const notificationId = req.params.id;

        if (!notificationId) {
            throw new ValidationError("Notification ID is required", {event: "notifications.get.failed", reason: "Notification ID not provided"});
        }

        req.infoEvent("notifications.mark_as_read.attempt", "User is attempting to mark a notification as read", {notificationId});

        const notification = await getNotificationById(notificationId);

        if (!notification) {
            throw new NotFoundError("Notification not found", {event: "notifications.mark_as_read.failed", reason: "Notification not found"});
        }

        if (notification.user_id !== req.user.id) {
            throw new ForbiddenError("Notification does not belong to user", {event: "notifications.mark_as_read.failed", reason: "Notification does not belong to user"});
        }

        await markNotificationAsRead(notificationId);

        res.json({
            success: true,
            data: {notification}
        });

    });
};