/**
 * User Management Service
 * Role-based user creation:
 * - Super Admin: can create Admin, CAD, and Surveyor.
 * - Admin: can create CAD or Surveyor (CAD: email + password; Surveyor: phone + password).
 */

const User = require("../models/user/User");
const { USER_ROLES, USER_STATUS } = require("../config/constants");
const {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} = require("../utils/errors");

/** Roles that Super Admin is allowed to create */
const SUPER_ADMIN_CREATABLE_ROLES = [USER_ROLES.ADMIN, USER_ROLES.CAD, USER_ROLES.SURVEYOR];

/** Roles that Admin is allowed to create */
const ADMIN_CREATABLE_ROLES = [USER_ROLES.CAD, USER_ROLES.SURVEYOR];

/** Roles that Admin is allowed to view/update/delete (not Admin or Super Admin) */
const ADMIN_MANAGEABLE_ROLES = [USER_ROLES.CAD, USER_ROLES.SURVEYOR];

/**
 * Assert that the actor can manage (get/patch/delete) the target user.
 * Super Admin can manage any; Admin can only manage CAD and Surveyor.
 */
function assertCanManageUser(actor, targetUser) {
  if (!actor || !actor.role) {
    throw new ForbiddenError("Unauthorized");
  }
  if (actor.role === USER_ROLES.SUPER_ADMIN) {
    return;
  }
  if (actor.role === USER_ROLES.ADMIN) {
    if (!ADMIN_MANAGEABLE_ROLES.includes(targetUser.role)) {
      throw new ForbiddenError("Admin can only manage CAD or Surveyor users");
    }
    return;
  }
  throw new ForbiddenError("Insufficient permissions");
}

/**
 * Assert that the creator is allowed to create a user with the given role.
 * @param {Object} creator - Authenticated user (with role)
 * @param {string} targetRole - Role to create
 * @throws {ForbiddenError}
 */
function assertCanCreateRole(creator, targetRole) {
  if (!creator || !creator.role) {
    throw new ForbiddenError("Unauthorized");
  }

  if (creator.role === USER_ROLES.SUPER_ADMIN) {
    if (!SUPER_ADMIN_CREATABLE_ROLES.includes(targetRole)) {
      throw new ForbiddenError("Super Admin can only create Admin, CAD, or Surveyor users");
    }
    return;
  }

  if (creator.role === USER_ROLES.ADMIN) {
    if (!ADMIN_CREATABLE_ROLES.includes(targetRole)) {
      throw new ForbiddenError("Admin can only create CAD or Surveyor users");
    }
    return;
  }

  throw new ForbiddenError("Insufficient permissions to create users");
}

/**
 * Create a new user (Admin, CAD, or Surveyor) by Super Admin or Admin.
 * - Super Admin → Admin, CAD, or Surveyor.
 * - Admin → CAD (email, password, firstName, lastName?, cadCenter) or Surveyor (phone, password, firstName, lastName?).
 *
 * @param {Object} creator - Authenticated user performing the action
 * @param {Object} payload - Validated payload (role, email?, phone?, password, firstName, lastName?, cadCenter?)
 * @returns {Promise<{ user }>}
 */
async function createUser(creator, payload) {
  const { role, email, phone, password, firstName, lastName, cadCenter } = payload;

  assertCanCreateRole(creator, role);

  const normalizedFirstName = String(firstName || "").trim();
  const normalizedLastName = lastName != null ? String(lastName).trim() : "";

  if (!normalizedFirstName) {
    throw new BadRequestError("firstName is required and must be non-empty");
  }

  if (role === USER_ROLES.ADMIN) {
    return createAdminUser(creator, {
      email,
      password,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
    });
  }

  if (role === USER_ROLES.CAD) {
    return createCadUser(creator, {
      email,
      password,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      cadCenter,
    });
  }

  if (role === USER_ROLES.SURVEYOR) {
    return createSurveyorUser(creator, {
      phone,
      password,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
    });
  }

  throw new BadRequestError("Invalid role");
}

/**
 * Create Admin user (Super Admin only).
 */
async function createAdminUser(creator, { email, password, firstName, lastName }) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ "auth.email": normalizedEmail });
  if (existing) {
    throw new ConflictError("Email already registered");
  }

  const user = await User.create({
    role: USER_ROLES.ADMIN,
    status: USER_STATUS.ACTIVE,
    name: { first: firstName, last: lastName },
    auth: {
      email: normalizedEmail,
      password,
    },
    createdBy: creator._id,
  });

  return { user };
}

/**
 * Create CAD user (Admin only). cadCenter is optional for now (can be set later via patch).
 */
async function createCadUser(creator, { email, password, firstName, lastName, cadCenter }) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ "auth.email": normalizedEmail });
  if (existing) {
    throw new ConflictError("Email already registered");
  }

  let validatedCadCenter = null;
  if (cadCenter) {
    const CadCenter = require("../models/masters/CadCenter");
    const centerExists = await CadCenter.findById(cadCenter);
    if (!centerExists) {
      throw new NotFoundError("CAD center not found");
    }
    validatedCadCenter = cadCenter;
  }

  const userPayload = {
    role: USER_ROLES.CAD,
    status: USER_STATUS.ACTIVE,
    name: { first: firstName, last: lastName },
    auth: {
      email: normalizedEmail,
      password,
    },
    createdBy: creator._id,
  };
  if (validatedCadCenter) {
    userPayload.cadProfile = { cadCenter: validatedCadCenter };
  }

  const user = await User.create(userPayload);

  return { user };
}

/**
 * Create Surveyor user (Admin only). Created with phone + password; otpVerified set so they can login without OTP.
 */
async function createSurveyorUser(creator, { phone, password, firstName, lastName }) {
  const normalizedPhone = String(phone).trim();
  const existing = await User.findOne({ "auth.phone": normalizedPhone });
  if (existing) {
    throw new ConflictError("Phone number already registered");
  }

  const user = await User.create({
    role: USER_ROLES.SURVEYOR,
    status: USER_STATUS.ACTIVE,
    name: { first: firstName, last: lastName },
    auth: {
      phone: normalizedPhone,
      password,
      otpVerified: true,
    },
    createdBy: creator._id,
  });

  return { user };
}

/**
 * Base query for non-deleted users.
 */
const notDeleted = { deletedAt: null };

/**
 * Get user by ID. Excludes soft-deleted. Enforces role-based access.
 */
async function getById(actor, userId) {
  const user = await User.findOne({ _id: userId, ...notDeleted });
  if (!user) {
    throw new NotFoundError("User not found");
  }
  assertCanManageUser(actor, user);
  return { user };
}

/**
 * List users with pagination and optional filters (role, status).
 * Super Admin sees all; Admin sees only CAD and Surveyor.
 */
async function getAll(actor, options = {}) {
  const { page = 1, limit = 20, role, status } = options;
  const skip = Math.max(0, (Number(page) || 1) - 1) * Math.min(100, Math.max(1, Number(limit) || 20));
  const perPage = Math.min(100, Math.max(1, Number(limit) || 20));

  const filter = { ...notDeleted };

  if (actor.role === USER_ROLES.ADMIN) {
    filter.role = { $in: ADMIN_MANAGEABLE_ROLES };
  }

  if (role) {
    const r = String(role).toUpperCase();
    if (Object.values(USER_ROLES).includes(r)) {
      filter.role = r;
    }
  }
  if (status) {
    const s = String(status).toUpperCase();
    if (Object.values(USER_STATUS).includes(s)) {
      filter.status = s;
    }
  }

  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(perPage).lean(),
    User.countDocuments(filter),
  ]);

  return {
    items,
    meta: {
      page: Math.floor(skip / perPage) + 1,
      limit: perPage,
      total,
      totalPages: Math.ceil(total / perPage) || 1,
    },
  };
}

/**
 * Get users by role with pagination and optional status filter.
 * Enforces same access as getAll (Super Admin sees all; Admin only CAD/Surveyor).
 */
async function getByRole(actor, role, options = {}) {
  const normalizedRole = String(role).toUpperCase();
  if (!Object.values(USER_ROLES).includes(normalizedRole)) {
    throw new BadRequestError(`role must be one of: ${Object.values(USER_ROLES).join(", ")}`);
  }
  if (actor.role === USER_ROLES.ADMIN && !ADMIN_MANAGEABLE_ROLES.includes(normalizedRole)) {
    throw new ForbiddenError("Admin can only list CAD or Surveyor users");
  }
  return getAll(actor, { ...options, role: normalizedRole });
}

/**
 * Patch user (name, status; for CAD: cadCenter; for Surveyor: profile fields).
 * Does not allow changing role, email, or phone.
 */
async function patch(actor, userId, payload) {
  const user = await User.findById(userId);
  if (!user || user.deletedAt) {
    throw new NotFoundError("User not found");
  }
  assertCanManageUser(actor, user);

  const { firstName, lastName, status, cadCenter, district, taluka, category, surveyType } = payload;

  if (firstName !== undefined) {
    user.name.first = String(firstName).trim() || user.name.first;
  }
  if (lastName !== undefined) {
    user.name.last = String(lastName).trim();
  }
  if (status !== undefined) {
    const s = String(status).toUpperCase();
    if (Object.values(USER_STATUS).includes(s)) {
      user.status = s;
    }
  }

  if (user.role === USER_ROLES.CAD && cadCenter !== undefined) {
    const CadCenter = require("../models/masters/CadCenter");
    const centerExists = await CadCenter.findById(cadCenter);
    if (!centerExists) {
      throw new NotFoundError("CAD center not found");
    }
    user.cadProfile = user.cadProfile || {};
    user.cadProfile.cadCenter = cadCenter;
  }

  if (user.role === USER_ROLES.SURVEYOR && (district !== undefined || taluka !== undefined || category !== undefined || surveyType !== undefined)) {
    user.surveyorProfile = user.surveyorProfile || {};
    if (district !== undefined) user.surveyorProfile.district = district;
    if (taluka !== undefined) user.surveyorProfile.taluka = taluka;
    if (category !== undefined) {
      const c = String(category).toUpperCase();
      if (["PUBLIC", "SURVEYOR"].includes(c)) {
        user.surveyorProfile.category = c;
        if (c === "PUBLIC") user.surveyorProfile.surveyType = undefined;
      }
    }
    if (surveyType !== undefined && user.surveyorProfile.category === "SURVEYOR") {
      const st = String(surveyType).toUpperCase();
      if (["LS", "GS"].includes(st)) user.surveyorProfile.surveyType = st;
    }
  }

  await user.save();
  return { user };
}

/**
 * Soft-delete user (set deletedAt). Enforces role-based access.
 */
async function deleteById(actor, userId) {
  const user = await User.findOne({ _id: userId, ...notDeleted });
  if (!user) {
    throw new NotFoundError("User not found");
  }
  assertCanManageUser(actor, user);
  user.deletedAt = new Date();
  await user.save();
  return { message: "User deleted successfully" };
}

/**
 * Block user (set status to DISABLED).
 * Super Admin can block any user (Admin, CAD, Surveyor). Admin can block only CAD or Surveyor (not Admin).
 * Cannot block self.
 */
async function blockUser(actor, userId) {
  if (String(actor._id) === String(userId)) {
    throw new BadRequestError("You cannot block yourself");
  }
  const user = await User.findOne({ _id: userId, ...notDeleted });
  if (!user) {
    throw new NotFoundError("User not found");
  }
  assertCanManageUser(actor, user);
  user.status = USER_STATUS.DISABLED;
  await user.save();
  return { user, message: "User blocked successfully" };
}

/**
 * Unblock user (set status to ACTIVE).
 * Same permissions as block: Super Admin can unblock any; Admin only CAD or Surveyor.
 */
async function unblockUser(actor, userId) {
  const user = await User.findOne({ _id: userId, ...notDeleted });
  if (!user) {
    throw new NotFoundError("User not found");
  }
  assertCanManageUser(actor, user);
  user.status = USER_STATUS.ACTIVE;
  await user.save();
  return { user, message: "User unblocked successfully" };
}

module.exports = {
  createUser,
  assertCanCreateRole,
  getById,
  getAll,
  getByRole,
  patch,
  deleteById,
  blockUser,
  unblockUser,
};
