/**
 * CAD Center service – create, update, delete, get, list.
 */

const CadCenter = require("../../models/masters/CadCenter");
const { NotFoundError, ConflictError, BadRequestError } = require("../../utils/errors");

const notDeleted = { deletedAt: null };

function normalizeCreate(payload) {
  const {
    name,
    code,
    address,
    contact,
    description,
    status,
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

async function list(filters = {}, pagination = null) {
  const query = { ...notDeleted };
  if (filters.status) {
    const s = String(filters.status).toUpperCase();
    if (["ACTIVE", "INACTIVE"].includes(s)) query.status = s;
  }

  const sort = { name: 1 };
  if (!pagination) {
    return CadCenter.find(query).sort(sort).lean();
  }

  const { skip, limit } = pagination;
  const [data, total] = await Promise.all([
    CadCenter.find(query).sort(sort).skip(skip).limit(limit).lean(),
    CadCenter.countDocuments(query),
  ]);
  return { data, total };
}

async function update(id, updates) {
  const center = await CadCenter.findOne({ _id: id, ...notDeleted });
  if (!center) {
    throw new NotFoundError("CAD center not found", { code: "CAD_CENTER_NOT_FOUND" });
  }

  if (updates.code) updates.code = String(updates.code).toUpperCase();

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
  list,
  update,
  remove,
};
