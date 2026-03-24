import type { NotificationRow } from "../types/database";

const { dbGet, dbGetAll, dbRun } = require("@modules/database") as {
    dbGet: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    dbGetAll: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    dbRun: (sql: string, params?: unknown[]) => Promise<number>;
};

async function getNotificationById(notificationId: number): Promise<NotificationRow | undefined> {
    const notification = await dbGet<NotificationRow>("SELECT * FROM notifications WHERE id = ?", [notificationId]);
    return notification;
}

async function getNotificationsForUser(userId: number): Promise<NotificationRow[]> {
    const notifications = await dbGetAll<NotificationRow>("SELECT * FROM notifications WHERE user_id = ?", [userId]);
    return notifications;
}

async function markNotificationAsRead(notificationId: number): Promise<void> {
    await dbRun("UPDATE notifications SET is_read = 1 WHERE id = ?", [notificationId]);
}

async function createNotification(userId: number, type: string, data: Record<string, unknown>): Promise<void> {
    await dbRun("INSERT INTO notifications (user_id, type, data) VALUES (?, ?, ?)", [userId, type, JSON.stringify(data)]);
}

async function deleteNotification(notificationId: number): Promise<void> {
    await dbRun("DELETE FROM notifications WHERE id = ?", [notificationId]);
}

async function emptyInboxForUser(userId: number): Promise<void> {
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
