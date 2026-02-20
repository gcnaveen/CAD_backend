const mongoose = require("mongoose");
const { BadRequestError } = require("../utils/errors");

const STATUS_ENUM = ["ACTIVE", "INACTIVE"];

function parseJsonBody(event) {
  if (!event || event.body == null || event.body === "") return {};
  if (typeof event.body === "object") return event.body;
  try {
    return JSON.parse(event.body);
  } catch (e) {
    throw new BadRequestError("Invalid JSON body");
  }
}

function requireFields(obj, fields, messagePrefix = "Missing required fields") {
  const missing = fields.filter(
    (f) => obj?.[f] === undefined || obj?.[f] === null || obj?.[f] === ""
  );
  if (missing.length) {
    throw new BadRequestError(`${messagePrefix}: ${missing.join(", ")}`, {
      errors: missing.map((field) => ({ field, message: "Required" })),
    });
  }
}

function validObjectId(id, fieldName = "id") {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new BadRequestError(`Invalid ${fieldName}`, {
      errors: [{ field: fieldName, message: "Must be a valid ObjectId" }],
    });
  }
  return id;
}

function optionalStatus(body) {
  if (body.status != null) {
    const s = String(body.status).toUpperCase();
    if (!STATUS_ENUM.includes(s)) {
      throw new BadRequestError(`status must be one of: ${STATUS_ENUM.join(", ")}`, {
        errors: [{ field: "status", message: "Invalid value" }],
      });
    }
    return s;
  }
  return "ACTIVE";
}

function validate(schemaFn) {
  return (event) => {
    const body = parseJsonBody(event);
    return schemaFn(body);
  };
}

const schemas = {
  /** Super Admin: firstName, email, password. lastName optional. */
  superAdminRegister(body) {
    requireFields(body, ["firstName", "email", "password"]);
    return body;
  },

  /** Surveyor start: phone + name. lastName optional. */
  surveyorStart(body) {
    requireFields(body, ["phone", "firstName"]);
    return body;
  },

  /** Surveyor verify: phone + otp only. */
  surveyorVerifyOtp(body) {
    requireFields(body, ["phone", "otp"]);
    return body;
  },

  /** Surveyor complete registration: phone + password + profile (all required). */
  surveyorCompleteRegistration(body) {
    requireFields(body, ["phone", "password", "district", "taluka", "category"]);
    const category = String(body.category).toUpperCase();
    if (category !== "PUBLIC" && category !== "SURVEYOR") {
      throw new BadRequestError("category must be PUBLIC or SURVEYOR");
    }
    if (category === "SURVEYOR") {
      requireFields(body, ["surveyType"]);
      const surveyType = String(body.surveyType).toUpperCase();
      if (!["LS", "GS"].includes(surveyType)) {
        throw new BadRequestError("surveyType must be LS or GS");
      }
      return { ...body, category, surveyType };
    }
    return { ...body, category };
  },

  /** Login: email + password OR phone + password. */
  login(body) {
    requireFields(body, ["password"]);
    if (!body.email && !body.phone) {
      throw new BadRequestError("email or phone is required");
    }
    return body;
  },

  /**
   * Create user (Admin / CAD / Surveyor). Caller's role is enforced in service.
   * - ADMIN: email, password, firstName (lastName optional).
   * - CAD: email, password, firstName (lastName, cadCenter optional; cadCenter can be set later via patch).
   * - SURVEYOR: phone, password, firstName (lastName optional).
   */
  createUser(body) {
    requireFields(body, ["role", "password", "firstName"]);
    const role = String(body.role).toUpperCase();
    const allowedRoles = ["ADMIN", "CAD", "SURVEYOR"];
    if (!allowedRoles.includes(role)) {
      throw new BadRequestError(`role must be one of: ${allowedRoles.join(", ")}`, {
        errors: [{ field: "role", message: "Invalid value" }],
      });
    }
    const password = body.password;
    if (typeof password !== "string" || password.length < 8) {
      throw new BadRequestError("password must be at least 8 characters", {
        errors: [{ field: "password", message: "Min 8 characters" }],
      });
    }
    const firstName = String(body.firstName || "").trim();
    const lastName = body.lastName != null ? String(body.lastName).trim() : "";
    if (!firstName) {
      throw new BadRequestError("firstName is required and must be non-empty", {
        errors: [{ field: "firstName", message: "Required" }],
      });
    }
    if (role === "ADMIN") {
      requireFields(body, ["email"]);
      const email = String(body.email).toLowerCase().trim();
      if (!email) throw new BadRequestError("email is required and must be non-empty");
      return { role, email, password, firstName, lastName };
    }
    if (role === "CAD") {
      requireFields(body, ["email"]);
      const email = String(body.email).toLowerCase().trim();
      if (!email) throw new BadRequestError("email is required and must be non-empty");
      const cadCenter = body.cadCenter != null && body.cadCenter !== "" ? validObjectId(body.cadCenter, "cadCenter") : undefined;
      return { role, email, password, firstName, lastName, cadCenter };
    }
    if (role === "SURVEYOR") {
      requireFields(body, ["phone"]);
      const phone = String(body.phone).trim();
      if (!phone) throw new BadRequestError("phone is required and must be non-empty");
      return { role, phone, password, firstName, lastName };
    }
    return body;
  },

  /**
   * Patch user: optional firstName, lastName, status; for CAD optional cadCenter; for Surveyor optional district, taluka, category, surveyType.
   */
  userPatch(body) {
    const updates = {};
    if (body.firstName !== undefined) {
      updates.firstName = String(body.firstName).trim();
    }
    if (body.lastName !== undefined) {
      updates.lastName = String(body.lastName).trim();
    }
    if (body.status !== undefined) {
      const s = String(body.status).toUpperCase();
      if (!["ACTIVE", "DISABLED", "PENDING"].includes(s)) {
        throw new BadRequestError("status must be ACTIVE, DISABLED, or PENDING");
      }
      updates.status = s;
    }
    if (body.cadCenter !== undefined) {
      updates.cadCenter = validObjectId(body.cadCenter, "cadCenter");
    }
    if (body.district !== undefined) {
      updates.district = validObjectId(body.district, "district");
    }
    if (body.taluka !== undefined) {
      updates.taluka = validObjectId(body.taluka, "taluka");
    }
    if (body.category !== undefined) {
      const c = String(body.category).toUpperCase();
      if (!["PUBLIC", "SURVEYOR"].includes(c)) {
        throw new BadRequestError("category must be PUBLIC or SURVEYOR");
      }
      updates.category = c;
    }
    if (body.surveyType !== undefined) {
      const st = String(body.surveyType).toUpperCase();
      if (!["LS", "GS"].includes(st)) {
        throw new BadRequestError("surveyType must be LS or GS");
      }
      updates.surveyType = st;
    }
    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("At least one field to update is required");
    }
    return updates;
  },

  // -------- Masters (District / Taluka / Hobli) --------

  districtCreate(body) {
    requireFields(body, ["code", "name"]);
    const code = String(body.code).trim();
    const name = String(body.name).trim();
    if (!code || !name) throw new BadRequestError("code and name must be non-empty");
    return { code, name, status: optionalStatus(body) };
  },

  districtUpdate(body) {
    const updates = {};
    if (body.code !== undefined) {
      updates.code = String(body.code).trim();
      if (!updates.code) throw new BadRequestError("code must be non-empty");
    }
    if (body.name !== undefined) {
      updates.name = String(body.name).trim();
      if (!updates.name) throw new BadRequestError("name must be non-empty");
    }
    if (body.status !== undefined) updates.status = optionalStatus(body);
    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("At least one of code, name, or status is required");
    }
    return updates;
  },

  talukaCreate(body) {
    requireFields(body, ["code", "name", "district"]);
    const code = String(body.code).trim();
    const name = String(body.name).trim();
    const district = String(body.district).trim();
    if (!code || !name || !district) throw new BadRequestError("code, name, and district must be non-empty");
    return { code, name, districtName: district, status: optionalStatus(body) };
  },

  talukaUpdate(body) {
    const updates = {};
    if (body.code !== undefined) {
      updates.code = String(body.code).trim();
      if (!updates.code) throw new BadRequestError("code must be non-empty");
    }
    if (body.name !== undefined) {
      updates.name = String(body.name).trim();
      if (!updates.name) throw new BadRequestError("name must be non-empty");
    }
    if (body.status !== undefined) updates.status = optionalStatus(body);
    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("At least one of code, name, or status is required");
    }
    return updates;
  },

  hobliCreate(body) {
    requireFields(body, ["code", "name"]);
    const code = String(body.code).trim();
    const name = String(body.name).trim();
    if (!code || !name) throw new BadRequestError("code and name must be non-empty");
    // Either talukaId or taluka (name) required; districtId/district optional for lookup
    const talukaId = body.talukaId ? validObjectId(body.talukaId, "talukaId") : undefined;
    const talukaName = body.taluka ? String(body.taluka).trim() : null;
    if (!talukaId && !talukaName) {
      throw new BadRequestError("taluka or talukaId is required");
    }
    const districtId = body.districtId ? validObjectId(body.districtId, "districtId") : undefined;
    const districtName = body.district ? String(body.district).trim() : null;
    return {
      code,
      name,
      talukaId,
      talukaName: talukaName || undefined,
      districtId,
      districtName: districtName || undefined,
      status: optionalStatus(body),
    };
  },

  hobliUpdate(body) {
    const updates = {};
    if (body.code !== undefined) {
      updates.code = String(body.code).trim();
      if (!updates.code) throw new BadRequestError("code must be non-empty");
    }
    if (body.name !== undefined) {
      updates.name = String(body.name).trim();
      if (!updates.name) throw new BadRequestError("name must be non-empty");
    }
    if (body.status !== undefined) updates.status = optionalStatus(body);
    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("At least one of code, name, or status is required");
    }
    return updates;
  },

  // -------- Village (under District → Taluka → Hobli) --------
  villageCreate(body) {
    requireFields(body, ["code", "name", "district", "taluka", "hobli"]);
    const code = String(body.code).trim();
    const name = String(body.name).trim();
    if (!code || !name) throw new BadRequestError("code and name must be non-empty");
    const districtId = validObjectId(body.district, "district");
    const talukaId = validObjectId(body.taluka, "taluka");
    const hobliId = validObjectId(body.hobli, "hobli");
    return {
      code,
      name,
      districtId,
      talukaId,
      hobliId,
      status: optionalStatus(body),
    };
  },

  villageUpdate(body) {
    const updates = {};
    if (body.code !== undefined) {
      updates.code = String(body.code).trim();
      if (!updates.code) throw new BadRequestError("code must be non-empty");
    }
    if (body.name !== undefined) {
      updates.name = String(body.name).trim();
      if (!updates.name) throw new BadRequestError("name must be non-empty");
    }
    if (body.status !== undefined) updates.status = optionalStatus(body);
    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("At least one of code, name, or status is required");
    }
    return updates;
  },

  // -------- CAD Center --------
  /** Create: name, code, address (city, pincode required), contact (email or phone required). */
  cadCenterCreate(body) {
    requireFields(body, ["name", "code"]);
    const name = String(body.name).trim();
    const code = String(body.code).trim();
    if (!name) throw new BadRequestError("name is required and must be non-empty");
    if (!code) throw new BadRequestError("code is required and must be non-empty");
    requireFields(body, ["address"]);
    const address = body.address && typeof body.address === "object" ? body.address : {};
    const city = address.city != null ? String(address.city).trim() : "";
    const pincode = address.pincode != null ? String(address.pincode).trim() : "";
    if (!city) throw new BadRequestError("address.city is required");
    if (!pincode) throw new BadRequestError("address.pincode is required");
    requireFields(body, ["contact"]);
    const contact = body.contact && typeof body.contact === "object" ? body.contact : {};
    const hasEmail = contact.email != null && String(contact.email).trim() !== "";
    const hasPhone = contact.phone != null && String(contact.phone).trim() !== "";
    if (!hasEmail && !hasPhone) {
      throw new BadRequestError("contact is required: provide at least contact.email or contact.phone");
    }
    return body;
  },

  /** Update: all optional; at least one field required. */
  cadCenterUpdate(body) {
    const updates = {};
    if (body.name !== undefined) {
      updates.name = String(body.name).trim();
      if (!updates.name) throw new BadRequestError("name must be non-empty");
    }
    if (body.code !== undefined) {
      updates.code = String(body.code).trim();
      if (!updates.code) throw new BadRequestError("code must be non-empty");
    }
    if (body.address !== undefined && body.address !== null && typeof body.address === "object") {
      updates.address = {};
      if (body.address.city !== undefined) updates.address.city = String(body.address.city).trim();
      if (body.address.pincode !== undefined) updates.address.pincode = String(body.address.pincode).trim();
      if (body.address.street !== undefined) updates.address.street = String(body.address.street).trim();
      if (body.address.state !== undefined) updates.address.state = String(body.address.state).trim();
      if (body.address.country !== undefined) updates.address.country = String(body.address.country).trim();
    }
    if (body.contact !== undefined && body.contact !== null && typeof body.contact === "object") {
      updates.contact = {};
      if (body.contact.email !== undefined) updates.contact.email = String(body.contact.email).trim();
      if (body.contact.phone !== undefined) updates.contact.phone = String(body.contact.phone).trim();
      if (body.contact.alternatePhone !== undefined) updates.contact.alternatePhone = String(body.contact.alternatePhone).trim();
    }
    if (body.description !== undefined) updates.description = String(body.description).trim();
    if (body.status !== undefined) {
      const s = String(body.status).toUpperCase();
      if (!["ACTIVE", "INACTIVE"].includes(s)) throw new BadRequestError("status must be ACTIVE or INACTIVE");
      updates.status = s;
    }
    if (body.capacity !== undefined) updates.capacity = body.capacity === null ? null : Number(body.capacity);
    if (body.availabilityStatus !== undefined) {
      const a = String(body.availabilityStatus).toUpperCase();
      const { CAD_CENTER_AVAILABILITY } = require("../config/constants");
      if (!Object.values(CAD_CENTER_AVAILABILITY).includes(a)) {
        throw new BadRequestError("availabilityStatus must be AVAILABLE, BUSY, or OFFLINE");
      }
      updates.availabilityStatus = a;
    }
    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("At least one field to update is required");
    }
    return updates;
  },

  // -------- Survey Sketch Assignment (admin: assign survey sketch to CAD center) --------
  surveySketchAssignmentCreate(body) {
    requireFields(body, ["surveyorSketchUploadId", "cadCenterId"]);
    const surveyorSketchUploadId = validObjectId(body.surveyorSketchUploadId, "surveyorSketchUploadId");
    const cadCenterId = validObjectId(body.cadCenterId, "cadCenterId");
    // assignedToUserId – commented out for now; uncomment if assigning to a specific CAD user is required
    // const assignedToUserId = body.assignedToUserId ? validObjectId(body.assignedToUserId, "assignedToUserId") : undefined;
    let dueDate = null;
    if (body.dueDate != null && body.dueDate !== "") {
      dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) throw new BadRequestError("dueDate must be a valid date");
    }
    const notes = body.notes != null ? String(body.notes).trim().slice(0, 1000) : undefined;
    return {
      surveyorSketchUploadId,
      cadCenterId,
      // assignedToUserId: assignedToUserId || undefined,
      dueDate: dueDate || undefined,
      notes,
    };
  },

  /** CAD: respond to assignment – body optional; action "accept" | "reject", default "accept". */
  cadAssignmentRespond(body) {
    const action = (body?.action != null && body?.action !== "")
      ? String(body.action).toLowerCase().trim()
      : "accept";
    if (action !== "accept" && action !== "reject") {
      throw new BadRequestError('action must be "accept" or "reject"', {
        errors: [{ field: "action", message: "Invalid value" }],
      });
    }
    return { action };
  },

  surveySketchAssignmentUpdate(body) {
    const { SURVEY_SKETCH_ASSIGNMENT_STATUS } = require("../config/constants");
    const updates = {};
    if (body.status !== undefined) {
      const s = String(body.status).toUpperCase();
      if (!Object.values(SURVEY_SKETCH_ASSIGNMENT_STATUS).includes(s)) {
        throw new BadRequestError(
          `status must be one of: ${Object.values(SURVEY_SKETCH_ASSIGNMENT_STATUS).join(", ")}`
        );
      }
      updates.status = s;
    }
    // assignedToUserId – commented out for now; uncomment if assigning to a specific CAD user is required
    // if (body.assignedToUserId !== undefined) {
    //   updates.assignedTo = body.assignedToUserId ? validObjectId(body.assignedToUserId, "assignedToUserId") : null;
    // }
    if (body.dueDate !== undefined) {
      if (body.dueDate === null || body.dueDate === "") {
        updates.dueDate = null;
      } else {
        const d = new Date(body.dueDate);
        if (Number.isNaN(d.getTime())) throw new BadRequestError("dueDate must be a valid date");
        updates.dueDate = d;
      }
    }
    if (body.notes !== undefined) updates.notes = String(body.notes).trim().slice(0, 1000) || null;
    if (Object.keys(updates).length === 0) {
      throw new BadRequestError("At least one field to update is required");
    }
    return updates;
  },

  // -------- Surveyor Sketch Upload --------
  /**
   * Create surveyor sketch upload (survey info + document URLs).
   * Required: surveyType, district, taluka, hobli, village, surveyNo.
   * At least one document (moolaTippani, hissaTippani, atlas, rrPakkabook, kharabu) with a non-empty url.
   * Optional: others (string, max 2000). surveyor is set from auth, not body.
   */
  surveyorSketchUploadCreate(body) {
    const { SURVEY_SKETCH_DOCUMENT_KEYS } = require("../config/constants");
    requireFields(body, ["surveyType", "district", "taluka", "hobli", "village", "surveyNo"]);

    const surveyType = String(body.surveyType).toLowerCase().trim();
    if (!["joint_flat", "single_flat"].includes(surveyType)) {
      throw new BadRequestError("surveyType must be joint_flat or single_flat", {
        errors: [{ field: "surveyType", message: "Invalid value" }],
      });
    }

    const district = validObjectId(body.district, "district");
    const taluka = validObjectId(body.taluka, "taluk");
    const hobli = validObjectId(body.hobli, "hobli");
    const village = validObjectId(body.village, "village");

    const surveyNo = String(body.surveyNo ?? "").trim();
    if (!surveyNo) {
      throw new BadRequestError("surveyNo is required and must be non-empty", {
        errors: [{ field: "surveyNo", message: "Required" }],
      });
    }

    let hasDocument = false;
    const documents = {};
    for (const key of SURVEY_SKETCH_DOCUMENT_KEYS) {
      const raw = body[key];
      if (raw == null || raw === "") continue;
      const url = typeof raw === "string" ? raw.trim() : (raw.url || raw.path || "").toString().trim();
      if (!url) continue;
      hasDocument = true;
      documents[key] =
        typeof raw === "string"
          ? { url }
          : {
              url,
              fileName: raw.fileName != null ? String(raw.fileName).trim() : null,
              mimeType: raw.mimeType != null ? String(raw.mimeType).trim() : null,
              size: raw.size != null ? Number(raw.size) : null,
              uploadedAt: raw.uploadedAt ? new Date(raw.uploadedAt) : new Date(),
            };
    }
    if (!hasDocument) {
      throw new BadRequestError(
        "At least one survey document is required (moolaTippani, hissaTippani, atlas, rrPakkabook, or kharabu with a non-empty url)",
        { errors: [{ field: "documents", message: "At least one document URL required" }] }
      );
    }

    let others = null;
    if (body.others != null && body.others !== "") {
      others = String(body.others).trim();
      if (others.length > 2000) {
        throw new BadRequestError("others must be at most 2000 characters", {
          errors: [{ field: "others", message: "Max 2000 characters" }],
        });
      }
    }

    // Optional audio: single file (string URL or object with url, fileName?, mimeType?, size?, uploadedAt?)
    let audio = null;
    if (body.audio != null && body.audio !== "") {
      const raw = body.audio;
      const url = typeof raw === "string" ? raw.trim() : (raw?.url || raw?.path || "").toString().trim();
      if (url) {
        audio =
          typeof raw === "string"
            ? { url }
            : {
                url,
                fileName: raw.fileName != null ? String(raw.fileName).trim() : null,
                mimeType: raw.mimeType != null ? String(raw.mimeType).trim() : null,
                size: raw.size != null ? Number(raw.size) : null,
                uploadedAt: raw.uploadedAt ? new Date(raw.uploadedAt) : new Date(),
              };
      }
    }

    // Optional other_documents: array of { url, fileName?, mimeType?, size?, uploadedAt? } (extra files, not audio)
    let other_documents = [];
    if (Array.isArray(body.other_documents) && body.other_documents.length > 0) {
      const maxOtherDocs = 20;
      if (body.other_documents.length > maxOtherDocs) {
        throw new BadRequestError(`other_documents must have at most ${maxOtherDocs} items`, {
          errors: [{ field: "other_documents", message: `Max ${maxOtherDocs} items` }],
        });
      }
      for (const raw of body.other_documents) {
        const url = typeof raw === "string" ? raw.trim() : (raw?.url || raw?.path || "").toString().trim();
        if (!url) continue;
        other_documents.push(
          typeof raw === "string"
            ? { url }
            : {
                url,
                fileName: raw.fileName != null ? String(raw.fileName).trim() : null,
                mimeType: raw.mimeType != null ? String(raw.mimeType).trim() : null,
                size: raw.size != null ? Number(raw.size) : null,
                uploadedAt: raw.uploadedAt ? new Date(raw.uploadedAt) : new Date(),
              }
        );
      }
    }

    return {
      surveyType,
      district,
      taluka,
      hobli,
      village,
      surveyNo,
      documents,
      audio: audio || undefined,
      others: others || undefined,
      other_documents: other_documents.length ? other_documents : undefined,
    };
  },

  // -------- Upload (image / audio only) --------
  /** Request body for image upload URL. Required: fileName, contentType. Optional: entityId, fileSizeBytes, expiresIn. */
  uploadImage(body) {
    requireFields(body, ["fileName", "contentType"]);
    const fileName = String(body.fileName || "").trim();
    if (!fileName) throw new BadRequestError("fileName is required and must be non-empty", { errors: [{ field: "fileName", message: "Required" }] });
    const contentType = String(body.contentType || "").trim().toLowerCase();
    if (!contentType) throw new BadRequestError("contentType is required", { errors: [{ field: "contentType", message: "Required" }] });
    const { UPLOAD_IMAGE_MIME_TYPES } = require("../config/constants");
    if (!UPLOAD_IMAGE_MIME_TYPES.includes(contentType)) {
      throw new BadRequestError(`contentType must be one of: ${UPLOAD_IMAGE_MIME_TYPES.join(", ")}`, { errors: [{ field: "contentType", message: "Invalid image type" }] });
    }
    return {
      fileName,
      contentType,
      entityId: body.entityId != null ? String(body.entityId).trim() : undefined,
      fileSizeBytes: body.fileSizeBytes != null ? Number(body.fileSizeBytes) : undefined,
      expiresIn: body.expiresIn != null ? parseInt(body.expiresIn, 10) : undefined,
    };
  },

  /** Request body for audio upload URL. Required: fileName, contentType. Optional: entityId, fileSizeBytes, expiresIn. */
  uploadAudio(body) {
    requireFields(body, ["fileName", "contentType"]);
    const fileName = String(body.fileName || "").trim();
    if (!fileName) throw new BadRequestError("fileName is required and must be non-empty", { errors: [{ field: "fileName", message: "Required" }] });
    const contentType = String(body.contentType || "").trim().toLowerCase();
    if (!contentType) throw new BadRequestError("contentType is required", { errors: [{ field: "contentType", message: "Required" }] });
    const { UPLOAD_AUDIO_MIME_TYPES } = require("../config/constants");
    if (!UPLOAD_AUDIO_MIME_TYPES.includes(contentType)) {
      throw new BadRequestError(`contentType must be one of: ${UPLOAD_AUDIO_MIME_TYPES.join(", ")}`, { errors: [{ field: "contentType", message: "Invalid audio type" }] });
    }
    return {
      fileName,
      contentType,
      entityId: body.entityId != null ? String(body.entityId).trim() : undefined,
      fileSizeBytes: body.fileSizeBytes != null ? Number(body.fileSizeBytes) : undefined,
      expiresIn: body.expiresIn != null ? parseInt(body.expiresIn, 10) : undefined,
    };
  },

  /** Request body for delete. Required: one of key or fileUrl. */
  uploadDelete(body) {
    if (!body.key && !body.fileUrl) {
      throw new BadRequestError("Either key or fileUrl is required", { errors: [{ field: "key", message: "Required if fileUrl not provided" }] });
    }
    return {
      key: body.key != null ? String(body.key).trim() : undefined,
      fileUrl: body.fileUrl != null ? String(body.fileUrl).trim() : undefined,
    };
  },
};

module.exports = {
  validate,
  schemas,
  validObjectId,
  parseJsonBody,
};
