const {deleteNotification, getNotificationById} = require("@services/notification-service");
const {isAuthenticated} = require("@middleware/authentication");
const {NotFoundError} = require("@errors/not-found-error");

module.exports = (router) => {
    router.delete("/delete-notification/:id", isAuthenticated,async (req, res) => {
        
        const notificationId = req.params.id;
        const notification = await getNotificationById(notificationId);

        req.infoEvent("notifications.delete.attempt", "User is attempting to delete a notification", {notificationId});

        if (!notification) {
            throw new NotFoundError("Notification not found", {event: "notifications.delete.failed", reason: "Notification not found"});
        }

        if (notification.userId !== req.user.id) {
            throw new NotFoundError("Notification not found", {event: "notifications.delete.failed", reason: "Notification does not belong to user"});
        }

        await deleteNotification(notificationId);

        req.infoEvent("notifications.delete.success", "Notification deleted successfully");

        res.json({
            success: true,
            data: {}
        });
    });
};