const mongoose = require("mongoose");
const { BadRequestError } = require("../utils/errors");
const { pickSurveyDocumentRaw } = require("../utils/surveyDocumentKeys");
const { parseSurveyDocumentList } = require("../utils/surveyDocuments");

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

/** Surveyor profile category PUBLIC — sketch upload files not mandatory. */
function isPublicSurveyorCategory(category) {
  return String(category || "").trim().toUpperCase() === "PUBLIC";
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

function validateExact4Password(password, field = "password") {
  if (typeof password !== "string" || password.length !== 4) {
    throw new BadRequestError(`${field} must be exactly 4 characters`, {
      errors: [{ field, message: "Must be exactly 4 characters" }],
    });
  }
}

function parseRupeesToPaise(raw, field = "amountRupees") {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") {
    throw new BadRequestError(`${field} must be a number`, {
      errors: [{ field, message: "Invalid value" }],
    });
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestError(`${field} must be a non-negative number`, {
      errors: [{ field, message: "Invalid value" }],
    });
  }
  return Math.round(n * 100);
}

/**
 * Optional payment amount from frontend for PhonePe checkout.
 * Accepts one of: amount / amountRupees (₹) or amountPaise.
 * @returns {number|undefined} paise, or undefined if none sent
 */
function parseOptionalClientPaymentAmountPaise(body = {}) {
  let amountPaise;
  if (body.amountPaise !== undefined && body.amountPaise !== null && body.amountPaise !== "") {
    const n = typeof body.amountPaise === "number" ? body.amountPaise : parseInt(String(body.amountPaise), 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestError("amountPaise must be a positive integer", {
        errors: [{ field: "amountPaise", message: "Invalid value" }],
      });
    }
    amountPaise = n;
  }
  const rupeeSource =
    body.amountRupees !== undefined && body.amountRupees !== null && body.amountRupees !== ""
      ? "amountRupees"
      : body.amount !== undefined && body.amount !== null && body.amount !== ""
        ? "amount"
        : null;
  if (rupeeSource) {
    if (amountPaise !== undefined) {
      throw new BadRequestError("Send only one of amountPaise, amountRupees, or amount", {
        errors: [{ field: "body", message: "Conflicting amount fields" }],
      });
    }
    amountPaise = parseRupeesToPaise(body[rupeeSource], rupeeSource);
    if (amountPaise <= 0) {
      throw new BadRequestError(`${rupeeSource} must be greater than zero`, {
        errors: [{ field: rupeeSource, message: "Invalid value" }],
      });
    }
  }
  return amountPaise;
}

const schemas = {
  /** Super Admin: firstName, email, password. lastName optional. */
  superAdminRegister(body) {
    requireFields(body, ["firstName", "email", "password"]);
    validateExact4Password(body.password, "password");
    const firstName = String(body.firstName || "").trim();
    const lastName = body.lastName != null ? String(body.lastName).trim() : "";
    if (!firstName) {
      throw new BadRequestError("firstName is required and must be non-empty", {
        errors: [{ field: "firstName", message: "Required" }],
      });
    }
    return { ...body, firstName, lastName };
  },

  /** Surveyor start: phone + firstName. lastName optional. */
  surveyorStart(body) {
    requireFields(body, ["phone", "firstName"]);
    const firstName = String(body.firstName || "").trim();
    const lastName = body.lastName != null ? String(body.lastName).trim() : "";
    if (!firstName) {
      throw new BadRequestError("firstName is required and must be non-empty", {
        errors: [{ field: "firstName", message: "Required" }],
      });
    }
    return { ...body, firstName, lastName };
  },

  /** Surveyor verify: phone + otp only. */
  surveyorVerifyOtp(body) {
    requireFields(body, ["phone", "otp"]);
    return body;
  },

  /** Surveyor complete registration: phone + password + profile (all required). */
  surveyorCompleteRegistration(body) {
    requireFields(body, ["phone", "password", "district", "taluka", "category"]);
    validateExact4Password(body.password, "password");
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

  /**
   * Surveyor forgot password (step 1): send OTP to phone.
   * Body: phone
   */
  surveyorForgotPasswordStart(body) {
    requireFields(body, ["phone"]);
    return body;
  },

  /**
   * Surveyor forgot password (step 2): verify OTP and reset password.
   * Body: phone + otp + password (password must be exactly 4 chars)
   */
  surveyorForgotPasswordReset(body) {
    requireFields(body, ["phone", "otp", "password"]);
    validateExact4Password(body.password, "password");
    return body;
  },

  /** Public CAD interest form submission. */
  cadInterestCreate(body) {
    requireFields(body, ["name", "email", "phone", "address", "skills", "yearsOfExperience"]);
    const name = String(body.name).trim();
    const email = String(body.email).toLowerCase().trim();
    const phone = String(body.phone).trim();
    const address = String(body.address).trim();

    if (!name) throw new BadRequestError("name must be non-empty");
    if (!email) throw new BadRequestError("email must be non-empty");
    if (!phone) throw new BadRequestError("phone must be non-empty");
    if (!address) throw new BadRequestError("address must be non-empty");

    const skills = Array.isArray(body.skills)
      ? body.skills.map((s) => String(s).trim()).filter(Boolean)
      : String(body.skills || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    if (!skills.length) {
      throw new BadRequestError("skills must be a non-empty array or comma-separated string");
    }

    const yearsOfExperience = Number(body.yearsOfExperience);
    if (!Number.isFinite(yearsOfExperience) || yearsOfExperience < 0 || yearsOfExperience > 60) {
      throw new BadRequestError("yearsOfExperience must be a number between 0 and 60");
    }

    const resumeUrl = body.resumeUrl != null && body.resumeUrl !== "" ? String(body.resumeUrl).trim() : undefined;

    return { name, email, phone, address, skills, yearsOfExperience, resumeUrl };
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
   * - CAD: email, password, firstName (lastName optional, cadCenter optional; cadCenter can be set later via patch).
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
    validateExact4Password(password, "password");
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
    const asTrimmed = (v) => String(v).trim();
    const hasAny = (obj) => obj && typeof obj === "object" && Object.keys(obj).length > 0;
    const normalizeNullableString = (v) => {
      const s = asTrimmed(v);
      return s ? s : null;
    };
    const assertHttpUrlOrNull = (value, fieldName) => {
      const s = normalizeNullableString(value);
      if (s === null) return null;
      // common browser placeholder path; never a real URL
      if (/^([a-zA-Z]:\\|\\\\|\/)/.test(s) || s.toLowerCase().includes("fakepath")) {
        throw new BadRequestError(`${fieldName} must be an uploaded URL (not a local file path)`, {
          errors: [{ field: fieldName, message: "Invalid URL" }],
        });
      }
      if (!/^https?:\/\//i.test(s)) {
        throw new BadRequestError(`${fieldName} must be a valid http(s) URL`, {
          errors: [{ field: fieldName, message: "Invalid URL" }],
        });
      }
      return s;
    };
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
    if (body.personalDetails !== undefined) {
      const p = body.personalDetails;
      if (!p || typeof p !== "object") throw new BadRequestError("personalDetails must be an object");
      const personalDetails = {};
      if (p.firstName !== undefined) personalDetails.firstName = normalizeNullableString(p.firstName);
      if (p.lastName !== undefined) personalDetails.lastName = normalizeNullableString(p.lastName);
      if (p.phone !== undefined) personalDetails.phone = normalizeNullableString(p.phone);
      if (p.email !== undefined) {
        const email = normalizeNullableString(p.email);
        personalDetails.email = email ? String(email).toLowerCase() : null;
      }
      if (p.address !== undefined) personalDetails.address = normalizeNullableString(p.address);
      if (p.profilePhotoUrl !== undefined) {
        personalDetails.profilePhotoUrl = assertHttpUrlOrNull(p.profilePhotoUrl, "personalDetails.profilePhotoUrl");
      }
      if (hasAny(personalDetails)) updates.personalDetails = personalDetails;
    }
    if (body.kycDetails !== undefined) {
      const k = body.kycDetails;
      if (!k || typeof k !== "object") throw new BadRequestError("kycDetails must be an object");
      const kycDetails = {};
      if (k.aadhaarPhotoUrl !== undefined) {
        kycDetails.aadhaarPhotoUrl = assertHttpUrlOrNull(k.aadhaarPhotoUrl, "kycDetails.aadhaarPhotoUrl");
      }
      if (hasAny(kycDetails)) updates.kycDetails = kycDetails;
    }
    if (body.bankDetails !== undefined) {
      const b = body.bankDetails;
      if (!b || typeof b !== "object") throw new BadRequestError("bankDetails must be an object");
      const bankDetails = {};
      if (b.accountNumber !== undefined) bankDetails.accountNumber = asTrimmed(b.accountNumber);
      if (b.accountHolderName !== undefined) bankDetails.accountHolderName = asTrimmed(b.accountHolderName);
      if (b.bankName !== undefined) bankDetails.bankName = asTrimmed(b.bankName);
      if (b.branchName !== undefined) bankDetails.branchName = asTrimmed(b.branchName);
      if (b.ifscCode !== undefined) bankDetails.ifscCode = asTrimmed(b.ifscCode).toUpperCase();
      if (hasAny(bankDetails)) updates.bankDetails = bankDetails;
    }
    if (body.upiDetails !== undefined) {
      const u = body.upiDetails;
      if (!u || typeof u !== "object") throw new BadRequestError("upiDetails must be an object");
      const upiDetails = {};
      if (u.upiId !== undefined) upiDetails.upiId = asTrimmed(u.upiId).toLowerCase();
      if (hasAny(upiDetails)) updates.upiDetails = upiDetails;
    }
    if (body.professionalDetails !== undefined) {
      const p = body.professionalDetails;
      if (!p || typeof p !== "object") throw new BadRequestError("professionalDetails must be an object");
      const professionalDetails = {};
      if (p.skills !== undefined) {
        if (!Array.isArray(p.skills)) throw new BadRequestError("professionalDetails.skills must be an array");
        professionalDetails.skills = p.skills.map((s) => asTrimmed(s)).filter(Boolean);
      }
      if (p.experienceYears !== undefined) {
        const years = Number(p.experienceYears);
        if (!Number.isFinite(years) || years < 0) {
          throw new BadRequestError("professionalDetails.experienceYears must be a non-negative number");
        }
        professionalDetails.experienceYears = years;
      }
      if (p.resumeUrl !== undefined) {
        professionalDetails.resumeUrl = assertHttpUrlOrNull(p.resumeUrl, "professionalDetails.resumeUrl");
      }
      if (hasAny(professionalDetails)) updates.professionalDetails = professionalDetails;
    }
    if (body.documents !== undefined) {
      const d = body.documents;
      if (!d || typeof d !== "object") throw new BadRequestError("documents must be an object");
      const documents = {};
      if (d.addressProofUrl !== undefined) {
        documents.addressProofUrl = assertHttpUrlOrNull(d.addressProofUrl, "documents.addressProofUrl");
      }
      if (hasAny(documents)) updates.documents = documents;
    }
    if (body.profileCompleted !== undefined) {
      if (typeof body.profileCompleted !== "boolean") {
        throw new BadRequestError("profileCompleted must be a boolean");
      }
      updates.profileCompleted = body.profileCompleted;
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

  // -------- Survey Sketch Assignment (admin: assign survey sketch to CAD user or legacy center) --------
  surveySketchAssignmentCreate(body) {
    requireFields(body, ["surveyorSketchUploadId"]);
    const surveyorSketchUploadId = validObjectId(body.surveyorSketchUploadId, "surveyorSketchUploadId");
    const cadCenterId =
      body.cadCenterId != null && body.cadCenterId !== ""
        ? validObjectId(body.cadCenterId, "cadCenterId")
        : null;
    let assignedCadUserId =
      body.assignedCadUserId != null && body.assignedCadUserId !== ""
        ? validObjectId(body.assignedCadUserId, "assignedCadUserId")
        : null;
    const cadUserId =
      body.cadUserId != null && body.cadUserId !== ""
        ? validObjectId(body.cadUserId, "cadUserId")
        : null;
    if (assignedCadUserId && cadUserId && String(assignedCadUserId) !== String(cadUserId)) {
      throw new BadRequestError("assignedCadUserId and cadUserId must be the same if both are sent", {
        code: "CONFLICTING_CAD_USER_IDS",
      });
    }
    if (!assignedCadUserId && cadUserId) {
      assignedCadUserId = cadUserId;
    }
    if (!cadCenterId && !assignedCadUserId) {
      throw new BadRequestError(
        "Provide cadUserId or assignedCadUserId (CAD user ObjectId), or cadCenterId for a real CAD center only",
        { code: "ASSIGNMENT_TARGET_REQUIRED" }
      );
    }
    let dueDate = null;
    if (body.dueDate != null && body.dueDate !== "") {
      dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) throw new BadRequestError("dueDate must be a valid date");
    }
    const notes = body.notes != null ? String(body.notes).trim().slice(0, 1000) : undefined;
    return {
      surveyorSketchUploadId,
      cadCenterId: cadCenterId || undefined,
      assignedCadUserId: assignedCadUserId || undefined,
      dueDate: dueDate || undefined,
      notes,
    };
  },

  /** CAD: finished sketch file metadata (URL from presigned PUT). Single file or files[]. */
  cadSketchDeliverable(body) {
    const { SURVEY_SKETCH_MAX_UPLOAD_FILES } = require("../config/constants");
    if (body.files !== undefined) {
      const files = parseSurveyDocumentList(body.files, {
        maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
        fieldName: "files",
        required: true,
      });
      return { files };
    }
    const files = parseSurveyDocumentList(body, {
      maxItems: 1,
      fieldName: "url",
      required: true,
    });
    return { files };
  },

  /** Surveyor: request sketch revision with optional remarks/audio. */
  sketchRevisionRequest(body) {
    const payload = {};
    const retryPayment =
      body.retryPayment === true ||
      String(body.retryPayment || "").toLowerCase() === "true" ||
      body.retry_payment === true ||
      String(body.retry_payment || "").toLowerCase() === "true";
    if (retryPayment) payload.retryPayment = true;

    if (body.remarks !== undefined) {
      payload.remarks = String(body.remarks).trim().slice(0, 2000) || null;
    }
    if (body.audio !== undefined && body.audio !== null) {
      const raw = body.audio;
      if (typeof raw !== "object") {
        throw new BadRequestError("audio must be an object");
      }
      const url = String(raw.url ?? "").trim();
      if (!url) {
        throw new BadRequestError("audio.url is required when audio is provided");
      }
      payload.audio = {
        url,
        fileName: raw.fileName != null ? String(raw.fileName).trim() : undefined,
        mimeType: raw.mimeType != null ? String(raw.mimeType).trim() : undefined,
        size: raw.size !== undefined && raw.size !== null ? raw.size : undefined,
      };
    }
    const hasContent = payload.remarks !== undefined || payload.audio !== undefined;
    if (!payload.retryPayment && !hasContent) {
      throw new BadRequestError("At least one of remarks or audio is required");
    }
    const clientAmountPaise = parseOptionalClientPaymentAmountPaise(body);
    if (clientAmountPaise !== undefined) {
      payload.amountPaise = clientAmountPaise;
    }
    return payload;
  },

  /** Surveyor: retry upload payment — optional amount override from frontend. */
  sketchPaymentRetry(body = {}) {
    const clientAmountPaise = parseOptionalClientPaymentAmountPaise(body || {});
    return clientAmountPaise !== undefined ? { amountPaise: clientAmountPaise } : {};
  },

  surveyorCadFeedbackCreate(body) {
    requireFields(body, ["rating"]);
    const rating = Number(body.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestError("rating must be between 1 and 5", {
        errors: [{ field: "rating", message: "Invalid value" }],
      });
    }
    const out = {
      rating: Math.round(rating * 10) / 10,
      remarks: body.remarks != null ? String(body.remarks).trim().slice(0, 2000) || null : null,
    };
    if (body.audio !== undefined && body.audio !== null) {
      if (typeof body.audio !== "object") {
        throw new BadRequestError("audio must be an object", {
          errors: [{ field: "audio", message: "Invalid value" }],
        });
      }
      const url = String(body.audio.url ?? "").trim();
      if (!url) {
        throw new BadRequestError("audio.url is required when audio is provided", {
          errors: [{ field: "audio.url", message: "Required" }],
        });
      }
      out.audio = {
        url,
        fileName: body.audio.fileName != null ? String(body.audio.fileName).trim() : undefined,
        mimeType: body.audio.mimeType != null ? String(body.audio.mimeType).trim() : undefined,
        size: body.audio.size !== undefined && body.audio.size !== null ? body.audio.size : undefined,
      };
    }
    return out;
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
    if (body.assignedCadUserId !== undefined && body.assignedCadUserId !== null && body.assignedCadUserId !== "") {
      updates.assignedCadUserId = validObjectId(String(body.assignedCadUserId).trim(), "assignedCadUserId");
    }
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

  adminAssignmentPullbackReassign(body) {
    requireFields(body, ["assignedCadUserId"]);
    const assignedCadUserId = validObjectId(String(body.assignedCadUserId).trim(), "assignedCadUserId");
    const reason = body.reason != null ? String(body.reason).trim().slice(0, 1000) : null;
    return { assignedCadUserId, reason };
  },

  /**
   * Admin CAD wallet: either payFull (settle remaining balance) or a single tranche in paise or rupees.
   * Do not send payFull together with amountPaise / amountRupees.
   */
  adminCadWalletRecordPayment(body) {
    const payFull =
      body.payFull === true ||
      body.payFull === "true" ||
      String(body.payFull || "").toLowerCase().trim() === "true";
    let amountPaise;
    if (body.amountPaise !== undefined && body.amountPaise !== null && body.amountPaise !== "") {
      const n = typeof body.amountPaise === "number" ? body.amountPaise : parseInt(String(body.amountPaise), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestError("amountPaise must be a positive integer", {
          errors: [{ field: "amountPaise", message: "Invalid value" }],
        });
      }
      amountPaise = n;
    }
    if (body.amountRupees !== undefined && body.amountRupees !== null && body.amountRupees !== "") {
      if (amountPaise !== undefined) {
        throw new BadRequestError("Send only one of amountPaise or amountRupees", {
          errors: [{ field: "body", message: "Conflicting amount fields" }],
        });
      }
      amountPaise = parseRupeesToPaise(body.amountRupees, "amountRupees");
      if (amountPaise <= 0) {
        throw new BadRequestError("amountRupees must be greater than zero", {
          errors: [{ field: "amountRupees", message: "Invalid value" }],
        });
      }
    }
    if (payFull && amountPaise !== undefined) {
      throw new BadRequestError("Do not send amount with payFull", {
        errors: [{ field: "body", message: "Use payFull alone or a partial amount, not both" }],
      });
    }
    if (!payFull && amountPaise === undefined) {
      throw new BadRequestError("Provide payFull: true or amountPaise / amountRupees", {
        errors: [{ field: "body", message: "Missing payment instruction" }],
      });
    }
    return payFull ? { payFull: true } : { payFull: false, amountPaise };
  },

  adminCadWalletPayCadUser(body) {
    requireFields(body, ["cadUserId"]);
    const cadUserId = validObjectId(String(body.cadUserId).trim(), "cadUserId");
    const payFull =
      body.payFull === true || String(body.payFull || "").toLowerCase().trim() === "true";

    if (payFull) {
      if (
        body.amountPaise !== undefined && body.amountPaise !== null && body.amountPaise !== "" ||
        body.amountRupees !== undefined && body.amountRupees !== null && body.amountRupees !== "" ||
        body.amount !== undefined && body.amount !== null && body.amount !== ""
      ) {
        throw new BadRequestError("Send payFull: true alone, or a custom amount — not both", {
          code: "CONFLICTING_PAY_INSTRUCTION",
        });
      }
      return { cadUserId, payFull: true };
    }

    let amountPaise;
    if (body.amountPaise !== undefined && body.amountPaise !== null && body.amountPaise !== "") {
      const n = typeof body.amountPaise === "number" ? body.amountPaise : parseInt(String(body.amountPaise), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestError("amountPaise must be a positive integer", {
          errors: [{ field: "amountPaise", message: "Invalid value" }],
        });
      }
      amountPaise = n;
    }
    const rupeeSource =
      body.amountRupees !== undefined && body.amountRupees !== null && body.amountRupees !== ""
        ? "amountRupees"
        : body.amount !== undefined && body.amount !== null && body.amount !== ""
          ? "amount"
          : null;
    if (rupeeSource) {
      if (amountPaise !== undefined) {
        throw new BadRequestError("Send only one of amountPaise, amountRupees, or amount", {
          errors: [{ field: "body", message: "Conflicting amount fields" }],
        });
      }
      amountPaise = parseRupeesToPaise(body[rupeeSource], rupeeSource);
      if (amountPaise <= 0) {
        throw new BadRequestError(`${rupeeSource} must be greater than zero`, {
          errors: [{ field: rupeeSource, message: "Invalid value" }],
        });
      }
    }
    if (amountPaise === undefined) {
      throw new BadRequestError("Provide amount, amountRupees, amountPaise, or payFull: true", {
        errors: [{ field: "body", message: "Missing amount" }],
      });
    }
    return { cadUserId, payFull: false, amountPaise };
  },

  surveySketchAssignmentFlowUpdate(body) {
    requireFields(body, ["autoAssignEnabled"]);
    const raw = body.autoAssignEnabled;
    const normalized =
      raw === true || raw === false
        ? raw
        : String(raw).toLowerCase().trim() === "true"
          ? true
          : String(raw).toLowerCase().trim() === "false"
            ? false
            : null;
    if (normalized === null) {
      throw new BadRequestError("autoAssignEnabled must be boolean", {
        errors: [{ field: "autoAssignEnabled", message: "Invalid value" }],
      });
    }
    return { autoAssignEnabled: normalized };
  },

  /** Admin: standard sketch upload / revision pricing (rupees). At least one field. */
  adminSketchPricingUpdate(body) {
    const out = {};
    const rupeeFields = [
      "sketchUploadPlanAmountRupees",
      "sketchUploadDiscountRupees",
      "sketchRevisionPlanAmountRupees",
      "sketchRevisionDiscountRupees",
    ];
    for (const field of rupeeFields) {
      if (body[field] === undefined) continue;
      if (body[field] === null) {
        out[field] = null;
        continue;
      }
      const n = typeof body[field] === "number" ? body[field] : Number(String(body[field]).trim());
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestError(`${field} must be null or a non-negative number`, {
          errors: [{ field, message: "Invalid value" }],
        });
      }
      out[field] = n;
    }
    if (Object.keys(out).length === 0) {
      throw new BadRequestError("At least one pricing field is required", {
        errors: [{ field: "body", message: "Empty update" }],
      });
    }
    return out;
  },

  // -------- Surveyor Sketch Upload --------
  /**
   * Create surveyor sketch upload (survey info + document URLs).
   * Required: surveyType, district, taluka, surveyNo.
   * Optional: hobli, village (ObjectIds from masters).
   * At least one upload field is required for surveyorProfile.category SURVEYOR only.
   * PUBLIC category surveyors may submit without files.
   * Optional: draftId (to cleanup submitted draft), others (string, max 2000).
   */
  surveyorSketchUploadCreate(body, { surveyorCategory } = {}) {
    const { SURVEY_SKETCH_DOCUMENT_KEYS, SURVEY_SKETCH_MAX_UPLOAD_FILES } = require("../config/constants");
    requireFields(body, ["surveyType", "district", "taluka", "surveyNo"]);

    const surveyType = String(body.surveyType).toLowerCase().trim();
    if (!["joint_flat", "single_flat"].includes(surveyType)) {
      throw new BadRequestError("surveyType must be joint_flat or single_flat", {
        errors: [{ field: "surveyType", message: "Invalid value" }],
      });
    }

    const district = validObjectId(body.district, "district");
    const taluka = validObjectId(body.taluka, "taluk");
    const hobli =
      body.hobli != null && body.hobli !== ""
        ? validObjectId(body.hobli, "hobli")
        : null;
    const village =
      body.village != null && body.village !== ""
        ? validObjectId(body.village, "village")
        : null;

    const surveyNo = String(body.surveyNo ?? "").trim();
    if (!surveyNo) {
      throw new BadRequestError("surveyNo is required and must be non-empty", {
        errors: [{ field: "surveyNo", message: "Required" }],
      });
    }

    const documents = {};
    for (const key of SURVEY_SKETCH_DOCUMENT_KEYS) {
      const raw = pickSurveyDocumentRaw(body, key);
      if (raw == null || raw === "") continue;
      const entries = parseSurveyDocumentList(raw, {
        maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
        fieldName: key,
      });
      if (entries.length) documents[key] = entries;
    }
    const uploadFilesRaw =
      body.singleUpload !== undefined && body.singleUpload !== null && body.singleUpload !== ""
        ? body.singleUpload
        : body.files;
    const singleUpload = parseSurveyDocumentList(uploadFilesRaw, {
      maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
      fieldName: body.singleUpload !== undefined ? "singleUpload" : "files",
    });

    const hasTypedDocuments = Object.values(documents).some((entries) => entries.length > 0);
    const uploadsRequired = !isPublicSurveyorCategory(surveyorCategory);
    if (uploadsRequired && !singleUpload.length && !hasTypedDocuments) {
      throw new BadRequestError(
        "Provide at least one upload: singleUpload, files, or one of moolaTippani/hissaTippani/atlas/rrPakkabook/kharabu",
        {
          errors: [
            {
              field: "singleUpload",
              message: "Either singleUpload, files, or any known document key is required",
            },
          ],
        }
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

    const audio = parseSurveyDocumentList(body.audio, {
      maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
      fieldName: "audio",
    });

    const other_documents = parseSurveyDocumentList(body.other_documents, {
      maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
      fieldName: "other_documents",
    });

    // Document indicator booleans.
    // Map from document key → boolean field name for auto-derivation.
    const DOC_KEY_TO_FLAG = {
      moolaTippani: "is_originaltippani",
      hissaTippani: "is_hissatippani",
      atlas: "is_atlas",
      rrPakkabook: "is_rrpakkabook",
      kharabu: "is_kharabuttar",
    };

    const INDICATOR_FIELDS = [
      "is_originaltippani",
      "is_hissatippani",
      "is_atlas",
      "is_rrpakkabook",
      "is_akarabandu",
      "is_kharabuttar",
      "is_mulapatra",
    ];

    const indicators = {};
    for (const field of INDICATOR_FIELDS) {
      indicators[field] = body[field] === true || body[field] === "true";
    }

    // Optional isSuperimpose boolean flag
    const isSuperimpose =
      body.isSuperimpose === true || body.isSuperimpose === "true" ? true : undefined;

    // Auto-set to true when the corresponding separate file(s) were uploaded
    for (const [docKey, flagName] of Object.entries(DOC_KEY_TO_FLAG)) {
      if (Array.isArray(documents[docKey]) && documents[docKey].length > 0) {
        indicators[flagName] = true;
      }
    }

    const clientAmountPaise = parseOptionalClientPaymentAmountPaise(body);

    return {
      surveyType,
      district,
      taluka,
      hobli,
      village,
      surveyNo,
      draftId: body.draftId != null && body.draftId !== "" ? validObjectId(body.draftId, "draftId") : undefined,
      documents,
      singleUpload: singleUpload.length ? singleUpload : undefined,
      ...indicators,
      isSuperimpose,
      audio: audio.length ? audio : undefined,
      others: others || undefined,
      other_documents: other_documents.length ? other_documents : undefined,
      ...(clientAmountPaise !== undefined ? { amountPaise: clientAmountPaise } : {}),
    };
  },

  /**
   * Survey draft payload parser (create/update): all fields optional for partial save.
   */
  surveyDraftUpsert(body, { requireAtLeastOne = false } = {}) {
    const { SURVEY_SKETCH_DOCUMENT_KEYS, SURVEY_SKETCH_MAX_UPLOAD_FILES } = require("../config/constants");
    const payload = {};

    if (body.surveyType !== undefined) {
      const surveyType = String(body.surveyType).toLowerCase().trim();
      if (!["joint_flat", "single_flat"].includes(surveyType)) {
        throw new BadRequestError("surveyType must be joint_flat or single_flat", {
          errors: [{ field: "surveyType", message: "Invalid value" }],
        });
      }
      payload.surveyType = surveyType;
    }

    if (body.district !== undefined) payload.district = body.district ? validObjectId(body.district, "district") : null;
    if (body.taluka !== undefined) payload.taluka = body.taluka ? validObjectId(body.taluka, "taluka") : null;
    if (body.hobli !== undefined) payload.hobli = body.hobli ? validObjectId(body.hobli, "hobli") : null;
    if (body.village !== undefined) payload.village = body.village ? validObjectId(body.village, "village") : null;
    if (body.surveyNo !== undefined) payload.surveyNo = body.surveyNo ? String(body.surveyNo).trim() : null;

    const documents = {};
    let hasAnyDocumentField = false;
    for (const key of SURVEY_SKETCH_DOCUMENT_KEYS) {
      const raw = pickSurveyDocumentRaw(body, key);
      if (raw === undefined) continue;
      hasAnyDocumentField = true;
      if (raw == null || raw === "") continue;
      const entries = parseSurveyDocumentList(raw, {
        maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
        fieldName: key,
      });
      if (entries.length) documents[key] = entries;
    }
    if (hasAnyDocumentField) payload.documents = documents;

    if (body.singleUpload !== undefined || body.files !== undefined) {
      const uploadFilesRaw =
        body.singleUpload !== undefined && body.singleUpload !== null && body.singleUpload !== ""
          ? body.singleUpload
          : body.files;
      if (uploadFilesRaw == null || uploadFilesRaw === "") {
        payload.singleUpload = [];
      } else {
        payload.singleUpload = parseSurveyDocumentList(uploadFilesRaw, {
          maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
          fieldName: body.singleUpload !== undefined ? "singleUpload" : "files",
        });
      }
    }

    const INDICATOR_FIELDS = [
      "is_originaltippani",
      "is_hissatippani",
      "is_atlas",
      "is_rrpakkabook",
      "is_akarabandu",
      "is_kharabuttar",
      "is_mulapatra",
    ];
    for (const field of INDICATOR_FIELDS) {
      if (body[field] === undefined) continue;
      payload[field] = body[field] === true || body[field] === "true";
    }

    if (body.isSuperimpose !== undefined) {
      payload.isSuperimpose = body.isSuperimpose === true || body.isSuperimpose === "true";
    }

    if (body.audio !== undefined) {
      if (body.audio == null || body.audio === "") {
        payload.audio = [];
      } else {
        payload.audio = parseSurveyDocumentList(body.audio, {
          maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
          fieldName: "audio",
        });
      }
    }

    if (body.other_documents !== undefined) {
      if (body.other_documents == null) {
        payload.other_documents = [];
      } else {
        payload.other_documents = parseSurveyDocumentList(body.other_documents, {
          maxItems: SURVEY_SKETCH_MAX_UPLOAD_FILES,
          fieldName: "other_documents",
        });
      }
    }

    if (body.others !== undefined) {
      if (body.others == null || body.others === "") payload.others = null;
      else {
        const others = String(body.others).trim();
        if (others.length > 2000) {
          throw new BadRequestError("others must be at most 2000 characters", {
            errors: [{ field: "others", message: "Max 2000 characters" }],
          });
        }
        payload.others = others;
      }
    }

    if (requireAtLeastOne && Object.keys(payload).length === 0) {
      throw new BadRequestError("At least one draft field is required");
    }

    return payload;
  },

  surveyDraftCreate(body) {
    return schemas.surveyDraftUpsert(body, { requireAtLeastOne: false });
  },

  surveyDraftUpdate(body) {
    return schemas.surveyDraftUpsert(body, { requireAtLeastOne: true });
  },

  notificationListQuery(query = {}) {
    const out = {};
    if (query.page !== undefined) out.page = query.page;
    if (query.limit !== undefined) out.limit = query.limit;
    if (query.type != null && query.type !== "") out.type = String(query.type).trim();
    if (query.unreadOnly != null && query.unreadOnly !== "") {
      const raw = String(query.unreadOnly).toLowerCase().trim();
      if (raw !== "true" && raw !== "false") {
        throw new BadRequestError("unreadOnly must be true or false", {
          errors: [{ field: "unreadOnly", message: "Invalid value" }],
        });
      }
      out.unreadOnly = raw === "true";
    }
    return out;
  },

  // -------- Upload (image / audio only) --------
  /** Request body for image upload URL. Required: fileName, contentType. Optional: entityId, fileSizeBytes, expiresIn. */
  uploadImage(body) {
    const { UPLOAD_BATCH_MAX_FILES } = require("../config/constants");
    if (Array.isArray(body.files) && body.files.length > 0) {
      if (body.files.length > UPLOAD_BATCH_MAX_FILES) {
        throw new BadRequestError(`files must have at most ${UPLOAD_BATCH_MAX_FILES} items`, {
          errors: [{ field: "files", message: `Max ${UPLOAD_BATCH_MAX_FILES} items` }],
        });
      }
      const files = body.files.map((item, index) => {
        const fileName = String(item?.fileName || "").trim();
        if (!fileName) {
          throw new BadRequestError("fileName is required for each file", {
            errors: [{ field: `files[${index}].fileName`, message: "Required" }],
          });
        }
        return {
          fileName,
          contentType: item?.contentType,
          fileSizeBytes: item?.fileSizeBytes != null ? Number(item.fileSizeBytes) : undefined,
        };
      });
      return {
        files,
        entityId: body.entityId != null ? String(body.entityId).trim() : undefined,
        expiresIn: body.expiresIn != null ? parseInt(body.expiresIn, 10) : undefined,
      };
    }

    requireFields(body, ["fileName"]);
    const fileName = String(body.fileName || "").trim();
    if (!fileName) {
      throw new BadRequestError("fileName is required and must be non-empty", {
        errors: [{ field: "fileName", message: "Required" }],
      });
    }
    return {
      fileName,
      contentType: body.contentType,
      entityId: body.entityId != null ? String(body.entityId).trim() : undefined,
      fileSizeBytes: body.fileSizeBytes != null ? Number(body.fileSizeBytes) : undefined,
      expiresIn: body.expiresIn != null ? parseInt(body.expiresIn, 10) : undefined,
    };
  },

  /** Request body for audio upload URL. Required: fileName, contentType. Optional: entityId, fileSizeBytes, expiresIn. */
  uploadAudio(body) {
    const { UPLOAD_BATCH_MAX_FILES } = require("../config/constants");
    if (Array.isArray(body.files) && body.files.length > 0) {
      if (body.files.length > UPLOAD_BATCH_MAX_FILES) {
        throw new BadRequestError(`files must have at most ${UPLOAD_BATCH_MAX_FILES} items`, {
          errors: [{ field: "files", message: `Max ${UPLOAD_BATCH_MAX_FILES} items` }],
        });
      }
      const files = body.files.map((item, index) => {
        const fileName = String(item?.fileName || "").trim();
        if (!fileName) {
          throw new BadRequestError("fileName is required for each file", {
            errors: [{ field: `files[${index}].fileName`, message: "Required" }],
          });
        }
        return {
          fileName,
          contentType: item?.contentType,
          fileSizeBytes: item?.fileSizeBytes != null ? Number(item.fileSizeBytes) : undefined,
        };
      });
      return {
        files,
        entityId: body.entityId != null ? String(body.entityId).trim() : undefined,
        expiresIn: body.expiresIn != null ? parseInt(body.expiresIn, 10) : undefined,
      };
    }

    requireFields(body, ["fileName"]);
    const fileName = String(body.fileName || "").trim();
    if (!fileName) {
      throw new BadRequestError("fileName is required and must be non-empty", {
        errors: [{ field: "fileName", message: "Required" }],
      });
    }
    return {
      fileName,
      contentType: body.contentType,
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
