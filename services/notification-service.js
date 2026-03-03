const {dbGet, dbGetAll, dbRun} = require("@modules/database");

async function getNotificationById(notificationId) {
    const notification = await dbGet("SELECT * FROM notifications WHERE id = ?", [notificationId]);
    return notification;
}

async function getNotificationsForUser(userId) {
    const notifications = await dbGetAll("SELECT * FROM notifications WHERE userId = ?", [userId]);
    return notifications;
}

async function createNotification(userId, type, data) {
    await dbRun("INSERT INTO notifications (userId, type, data) VALUES (?, ?, ?)", [userId, type, JSON.stringify(data)]);
}