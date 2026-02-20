/**
 * CAD Center service – create, update, delete, get, list.
 */

const CadCenter = require("../../models/masters/CadCenter");
const { NotFoundError, ConflictError, BadRequestError } = require("../../utils/errors");
const { CAD_CENTER_AVAILABILITY } = require("../../config/constants");

const notDeleted = { deletedAt: null };

function normalizeCreate(payload) {
  const {
    name,
    code,
    address,
    contact,
    description,
    status,
    availabilityStatus,
    capacity,
    metadata,
    createdBy,
  } = payload;

  const city = address?.city != null ? String(address.city).trim() : "";
  const pincode = address?.pincode != null ? String(address.pincode).trim() : "";
  const contactObj = contact || {};
  const email = contactObj.email != null ? String(contactObj.email).toLowerCase().trim() : "";
  const phone = contactObj.phone != null ? String(contactObj.phone).trim() : "";

  return {
    name: String(name || "").trim(),
    code: code != null ? String(code).trim().toUpperCase() : undefined,
    address: {
      city,
      pincode,
      street: address?.street != null ? String(address.street).trim() : undefined,
      state: address?.state != null ? String(address.state).trim() : undefined,
      country: address?.country != null ? String(address.country).trim() : "India",
    },
    contact: {
      email: email || undefined,
      phone: phone || undefined,
      alternatePhone: contactObj.alternatePhone != null ? String(contactObj.alternatePhone).trim() : undefined,
    },
    description: description != null ? String(description).trim() : undefined,
    status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    availabilityStatus:
      availabilityStatus && Object.values(CAD_CENTER_AVAILABILITY).includes(availabilityStatus)
        ? availabilityStatus
        : CAD_CENTER_AVAILABILITY.AVAILABLE,
    capacity: capacity != null ? Number(capacity) : null,
    metadata: metadata ? { establishedDate: metadata.establishedDate, notes: metadata.notes } : undefined,
    createdBy: createdBy || undefined,
  };
}

async function create(payload, createdBy) {
  const normalized = normalizeCreate(payload);

  if (!normalized.name) {
    throw new BadRequestError("name is required and must be non-empty", {
      errors: [{ field: "name", message: "Required" }],
    });
  }
  if (!normalized.address.city) {
    throw new BadRequestError("address.city is required", {
      errors: [{ field: "address.city", message: "Required" }],
    });
  }
  if (!normalized.address.pincode) {
    throw new BadRequestError("address.pincode is required", {
      errors: [{ field: "address.pincode", message: "Required" }],
    });
  }
  if (!normalized.contact.email && !normalized.contact.phone) {
    throw new BadRequestError("contact is required: provide at least contact.email or contact.phone", {
      errors: [{ field: "contact", message: "Required" }],
    });
  }

  const doc = new CadCenter({
    ...normalized,
    createdBy: createdBy || undefined,
  });

  try {
    await doc.save();
    return doc.toObject();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError("CAD center with this code already exists", {
        code: "DUPLICATE_CODE",
        errors: [{ field: "code", message: "Already exists" }],
      });
    }
    throw err;
  }
}

async function getById(id) {
  const doc = await CadCenter.findOne({ _id: id, ...notDeleted }).lean();
  if (!doc) {
    throw new NotFoundError("CAD center not found", { code: "CAD_CENTER_NOT_FOUND" });
  }
  return doc;
}

/** Get CAD center by ID with assignment count and list of assigned drawings (survey sketches). */
async function getByIdWithAssignments(id, assignmentOptions = {}) {
  const doc = await CadCenter.findOne({ _id: id, ...notDeleted }).lean();
  if (!doc) {
    throw new NotFoundError("CAD center not found", { code: "CAD_CENTER_NOT_FOUND" });
  }
  const SurveySketchAssignment = require("../../models/assignment/SurveySketchAssignment");
  const [countResult, assignments] = await Promise.all([
    SurveySketchAssignment.aggregate([
      { $match: { cadCenter: doc._id, status: { $ne: "CANCELLED" } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    SurveySketchAssignment.find({ cadCenter: id, status: { $ne: "CANCELLED" } })
      .sort({ assignedAt: -1 })
      .limit(assignmentOptions.limit || 100)
      .populate("surveyorSketchUpload", "applicationId surveyNo status createdAt")
      .populate("assignedTo", "name auth")
      .populate("assignedBy", "name")
      .lean(),
  ]);
  const byStatus = {};
  let total = 0;
  countResult.forEach((r) => {
    byStatus[r._id] = r.count;
    total += r.count;
  });
  return {
    ...doc,
    assignmentCount: total,
    assignmentCountByStatus: byStatus,
    assignments,
  };
}

async function list(filters = {}, pagination = null, options = {}) {
  const query = { ...notDeleted };
  if (filters.status) {
    const s = String(filters.status).toUpperCase();
    if (["ACTIVE", "INACTIVE"].includes(s)) query.status = s;
  }
  if (filters.availabilityStatus) {
    const a = String(filters.availabilityStatus).toUpperCase();
    if (Object.values(CAD_CENTER_AVAILABILITY).includes(a)) query.availabilityStatus = a;
  }

  const sort = { name: 1 };
  let data;
  if (!pagination) {
    data = await CadCenter.find(query).sort(sort).lean();
  } else {
    const { skip, limit } = pagination;
    const [list, total] = await Promise.all([
      CadCenter.find(query).sort(sort).skip(skip).limit(limit).lean(),
      CadCenter.countDocuments(query),
    ]);
    data = list;
    if (!options.includeAssignmentCounts) {
      return { data, total };
    }
    const totalCount = total;
    const centerIds = data.map((c) => c._id);
    const SurveySketchAssignment = require("../../models/assignment/SurveySketchAssignment");
    const counts = await SurveySketchAssignment.aggregate([
      { $match: { cadCenter: { $in: centerIds }, status: { $ne: "CANCELLED" } } },
      { $group: { _id: "$cadCenter", total: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((c) => {
      countMap[c._id.toString()] = c.total;
    });
    data = data.map((center) => ({
      ...center,
      assignmentCount: countMap[center._id.toString()] || 0,
    }));
    return { data, total: totalCount };
  }

  if (options.includeAssignmentCounts && data.length > 0) {
    const centerIds = data.map((c) => c._id);
    const SurveySketchAssignment = require("../../models/assignment/SurveySketchAssignment");
    const counts = await SurveySketchAssignment.aggregate([
      { $match: { cadCenter: { $in: centerIds }, status: { $ne: "CANCELLED" } } },
      { $group: { _id: "$cadCenter", total: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((c) => {
      countMap[c._id.toString()] = c.total;
    });
    data = data.map((center) => ({
      ...center,
      assignmentCount: countMap[center._id.toString()] || 0,
    }));
  }
  return data;
}

async function update(id, updates) {
  const center = await CadCenter.findOne({ _id: id, ...notDeleted });
  if (!center) {
    throw new NotFoundError("CAD center not found", { code: "CAD_CENTER_NOT_FOUND" });
  }

  if (updates.code) updates.code = String(updates.code).toUpperCase();
  if (
    updates.availabilityStatus &&
    !Object.values(CAD_CENTER_AVAILABILITY).includes(updates.availabilityStatus)
  ) {
    delete updates.availabilityStatus;
  }

  const existingAddress = center.address && typeof center.address.toObject === "function"
    ? center.address.toObject()
    : (center.address || {});
  const existingContact = center.contact && typeof center.contact.toObject === "function"
    ? center.contact.toObject()
    : (center.contact || {});
  if (updates.address && Object.keys(updates.address).length > 0) {
    updates.address = { ...existingAddress, ...updates.address };
  }
  if (updates.contact && Object.keys(updates.contact).length > 0) {
    updates.contact = { ...existingContact, ...updates.contact };
    if (updates.contact.email !== undefined) updates.contact.email = String(updates.contact.email).toLowerCase();
  }

  const updated = await CadCenter.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) throw new NotFoundError("CAD center not found", { code: "CAD_CENTER_NOT_FOUND" });
  return updated;
}

async function remove(id) {
  const center = await CadCenter.findOne({ _id: id, ...notDeleted });
  if (!center) {
    throw new NotFoundError("CAD center not found", { code: "CAD_CENTER_NOT_FOUND" });
  }
  center.deletedAt = new Date();
  await center.save();
  return { message: "CAD center deleted successfully" };
}

module.exports = {
  create,
  getById,
  getByIdWithAssignments,
  list,
  update,
  remove,
};
