const mongoose = require("mongoose");
const Notification = require("../models/notification/Notification");
const { NotFoundError, ForbiddenError } = require("../utils/errors");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function toObjectIdIfValid(id) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(String(id));
  return null;
}

function accessFilter(actor) {
  return {
    $or: [{ targetRoles: actor.role }, { targetUsers: actor._id }],
  };
}

function decorate(doc, actorId) {
  const readEntry = (doc.readBy || []).find((r) => String(r.user) === String(actorId));
  return {
    ...doc,
    isRead: Boolean(readEntry),
    readAt: readEntry?.readAt || null,
  };
}

async function create(payload) {
  const doc = await Notification.create({
    type: payload.type,
    title: payload.title,
    message: payload.message,
    entityType: payload.entityType || null,
    entityId: toObjectIdIfValid(payload.entityId),
    data: payload.data || null,
    targetRoles: Array.isArray(payload.targetRoles) ? payload.targetRoles : [],
    targetUsers: Array.isArray(payload.targetUsers) ? payload.targetUsers : [],
    createdBy: payload.createdBy || null,
  });
  return doc.toObject();
}

async function list(actor, options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  const filter = {
    deletedAt: null,
    ...accessFilter(actor),
  };
  if (options.type) filter.type = String(options.type).trim();
  if (options.unreadOnly === true) {
    filter.readBy = { $not: { $elemMatch: { user: actor._id } } };
  }

  const [rows, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  return {
    data: rows.map((r) => decorate(r, actor._id)),
    meta: { page, limit, total },
  };
}

async function getById(actor, notificationId) {
  const doc = await Notification.findOne({ _id: notificationId, deletedAt: null }).lean();
  if (!doc) throw new NotFoundError("Notification not found");
  const canAccess =
    (doc.targetRoles || []).includes(actor.role) ||
    (doc.targetUsers || []).some((u) => String(u) === String(actor._id));
  if (!canAccess) throw new ForbiddenError("You are not allowed to access this notification");
  return decorate(doc, actor._id);
}

async function markRead(actor, notificationId) {
  const updated = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      deletedAt: null,
      ...accessFilter(actor),
      readBy: { $not: { $elemMatch: { user: actor._id } } },
    },
    {
      $push: { readBy: { user: actor._id, readAt: new Date() } },
    },
    { new: true }
  ).lean();
  if (!updated) {
    const already = await Notification.findOne({
      _id: notificationId,
      deletedAt: null,
      ...accessFilter(actor),
    }).lean();
    if (!already) throw new NotFoundError("Notification not found");
    return decorate(already, actor._id);
  }
  return decorate(updated, actor._id);
}

async function markAllRead(actor) {
  await Notification.updateMany(
    {
      deletedAt: null,
      ...accessFilter(actor),
      readBy: { $not: { $elemMatch: { user: actor._id } } },
    },
    {
      $push: { readBy: { user: actor._id, readAt: new Date() } },
    }
  );
  return { message: "All notifications marked as read" };
}

module.exports = {
  create,
  list,
  getById,
  markRead,
  markAllRead,
};
