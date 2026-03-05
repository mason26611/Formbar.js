const { dbGet, dbGetAll, dbRun } = require("@modules/database");

async function getNotificationById(notificationId) {
    const notification = await dbGet("SELECT * FROM notifications WHERE id = ?", [notificationId]);
    return notification;
}

async function getNotificationsForUser(userId) {
    const notifications = await dbGetAll("SELECT * FROM notifications WHERE user_id = ?", [userId]);
    return notifications;
}

async function markNotificationAsRead(notificationId) {
    await dbRun("UPDATE notifications SET is_read = 1 WHERE id = ?", [notificationId]);
}

async function createNotification(userId, type, data) {
    await dbRun("INSERT INTO notifications (user_id, type, data) VALUES (?, ?, ?)", [userId, type, JSON.stringify(data)]);
}

async function deleteNotification(notificationId) {
    await dbRun("DELETE FROM notifications WHERE id = ?", [notificationId]);
}

async function emptyInboxForUser(userId) {
    await dbRun("DELETE FROM notifications WHERE user_id = ?", [userId]);
}

module.exports = {
    getNotificationById,
    getNotificationsForUser,
    markNotificationAsRead,
    createNotification,
    emptyInboxForUser,
    deleteNotification,
};
