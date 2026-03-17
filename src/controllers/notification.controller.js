const notificationService = require("../services/notification.service");
const { ok } = require("../utils/response");

async function listNotifications(actor, options) {
  const result = await notificationService.list(actor, options);
  return ok(result.data, result.meta);
}

async function getNotification(actor, notificationId) {
  const result = await notificationService.getById(actor, notificationId);
  return ok(result);
}

async function markNotificationRead(actor, notificationId) {
  const result = await notificationService.markRead(actor, notificationId);
  return ok(result);
}

async function markAllNotificationsRead(actor) {
  const result = await notificationService.markAllRead(actor);
  return ok(result);
}

module.exports = {
  listNotifications,
  getNotification,
  markNotificationRead,
  markAllNotificationsRead,
};
