const { getNotificationById, markNotificationAsRead } = require("@services/notification-service");
const { isAuthenticated } = require("@middleware/authentication");
const NotFoundError = require("@errors/not-found-error");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.post("/notifications/mark-notification-read/:id", isAuthenticated, async (req, res) => {
        const notificationId = req.params.id;

        if (!notificationId) {
            throw new ValidationError("Notification ID is required", { event: "notifications.get.failed", reason: "Notification ID not provided" });
        }

        req.infoEvent("notifications.mark_as_read.attempt", "User is attempting to mark a notification as read", { notificationId });

        const notification = await getNotificationById(notificationId);

        if (!notification) {
            throw new NotFoundError("Notification not found", { event: "notifications.mark_as_read.failed", reason: "Notification not found" });
        }

        if (notification.user_id !== req.user.id) {
            // If the notification does not belong to the user, return NotFoundError to avoid leaking information about the existence of the notification
            throw new NotFoundError("Notification not found", {
                event: "notifications.delete.failed",
                reason: "Notification does not belong to user",
                notificationId,
            });
        }

        await markNotificationAsRead(notificationId);
        notification.is_read = true;

        req.infoEvent("notifications.mark_as_read.success", "Notification marked as read successfully");

        res.json({
            success: true,
            data: { notification },
        });
    });
};
