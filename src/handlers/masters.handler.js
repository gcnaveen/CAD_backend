/**
 * Masters API handler – District → Taluka → Hobli hierarchy + CAD Center.
 * Ensures DB connection, validates input, delegates to controllers.
 * CAD Center endpoints require Super Admin or Admin role.
 */

const { connectDB } = require("../config/db");
const { validate, schemas, validObjectId } = require("../middleware/validator");
const { authorize } = require("../middleware/auth.middleware");
const { USER_ROLES } = require("../config/constants");
const districtController = require("../controllers/masters/district.controller");
const districtService = require("../services/masters/district.service");
const talukaController = require("../controllers/masters/taluka.controller");
const talukaService = require("../services/masters/taluka.service");
const hobliController = require("../controllers/masters/hobli.controller");
const hobliService = require("../services/masters/hobli.service");
const villageController = require("../controllers/masters/village.controller");
const cadCenterController = require("../controllers/masters/cadCenter.controller");
const { BadRequestError } = require("../utils/errors");
const asyncHandler = require("../utils/asyncHandler");
const { parsePagination } = require("../utils/pagination");

let dbConnected = false;

async function ensureDb() {
  if (!dbConnected) {
    await connectDB();
    dbConnected = true;
  }
}

function getPathParams(event) {
  return event.pathParameters || {};
}

function getQueryParams(event) {
  const q = event.queryStringParameters || {};
  const status = q.status ? String(q.status).toUpperCase() : null;
  const filters = { status: status && ["ACTIVE", "INACTIVE"].includes(status) ? status : null };

  if (q.district) filters.district = String(q.district).trim();
  if (q.taluka) filters.taluka = String(q.taluka).trim();
  if (q.districtId) filters.districtId = String(q.districtId).trim();
  if (q.talukaId) filters.talukaId = String(q.talukaId).trim();
  if (q.hobliId) filters.hobliId = String(q.hobliId).trim();
  if (q.availabilityStatus) {
    const a = String(q.availabilityStatus).toUpperCase();
    if (["AVAILABLE", "BUSY", "OFFLINE"].includes(a)) filters.availabilityStatus = a;
  }

  return filters;
}

function getPagination(event) {
  return parsePagination(event.queryStringParameters || {});
}

// -------- District --------
exports.createDistrict = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.districtCreate)(event);
  return await districtController.createDistrict(body);
});

exports.listDistricts = asyncHandler(async (event) => {
  await ensureDb();
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  return await districtController.listDistricts(filters, pagination);
});

exports.getDistrict = asyncHandler(async (event) => {
  await ensureDb();
  const { districtId } = getPathParams(event);
  if (!districtId) {
    throw new BadRequestError("districtId is required");
  }
  validObjectId(districtId, "districtId");
  return await districtController.getDistrict(districtId);
});

exports.updateDistrict = asyncHandler(async (event) => {
  await ensureDb();
  const { districtId } = getPathParams(event);
  validObjectId(districtId, "districtId");
  const body = validate(schemas.districtUpdate)(event);
  return await districtController.updateDistrict(districtId, body);
});

exports.listTalukasByDistrict = asyncHandler(async (event) => {
  await ensureDb();
  const { districtId } = getPathParams(event);
  if (!districtId) throw new BadRequestError("districtId is required");
  validObjectId(districtId, "districtId");
  await districtService.getById(districtId); // 404 if district not found
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  return await talukaController.listTalukas(districtId, filters, pagination);
});

// -------- Taluka (under District) --------
exports.createTaluka = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.talukaCreate)(event);
  return await talukaController.createTaluka(body);
});

exports.listTalukas = asyncHandler(async (event) => {
  await ensureDb();
  const q = event.queryStringParameters || {};
  const districtIdentifier = q.district || q.districtId || null;
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  return await talukaController.listTalukas(districtIdentifier, filters, pagination);
});

exports.getTaluka = asyncHandler(async (event) => {
  await ensureDb();
  const { talukaId } = getPathParams(event);
  if (!talukaId) {
    throw new BadRequestError("talukaId is required");
  }
  validObjectId(talukaId, "talukaId");
  return await talukaController.getTaluka(talukaId);
});

exports.updateTaluka = asyncHandler(async (event) => {
  await ensureDb();
  const { talukaId } = getPathParams(event);
  validObjectId(talukaId, "talukaId");
  const body = validate(schemas.talukaUpdate)(event);
  return await talukaController.updateTaluka(talukaId, body);
});

exports.listHoblisByTaluka = asyncHandler(async (event) => {
  await ensureDb();
  const { talukaId } = getPathParams(event);
  if (!talukaId) throw new BadRequestError("talukaId is required");
  validObjectId(talukaId, "talukaId");
  await talukaService.getById(talukaId); // 404 if taluka not found
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  return await hobliController.listHoblis(talukaId, null, filters, pagination);
});

// -------- Hobli (under Taluka) --------
exports.createHobli = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.hobliCreate)(event);
  return await hobliController.createHobli(body);
});

exports.listHoblis = asyncHandler(async (event) => {
  await ensureDb();
  const q = event.queryStringParameters || {};
  const talukaIdentifier = q.taluka || q.talukaId || null;
  const districtName = q.district || null;
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  return await hobliController.listHoblis(talukaIdentifier, districtName, filters, pagination);
});

exports.getHobli = asyncHandler(async (event) => {
  await ensureDb();
  const { hobliId } = getPathParams(event);
  if (!hobliId) {
    throw new BadRequestError("hobliId is required");
  }
  validObjectId(hobliId, "hobliId");
  return await hobliController.getHobli(hobliId);
});

exports.updateHobli = asyncHandler(async (event) => {
  await ensureDb();
  const { hobliId } = getPathParams(event);
  validObjectId(hobliId, "hobliId");
  const body = validate(schemas.hobliUpdate)(event);
  return await hobliController.updateHobli(hobliId, body);
});

exports.listVillagesByHobli = asyncHandler(async (event) => {
  await ensureDb();
  const { hobliId } = getPathParams(event);
  if (!hobliId) throw new BadRequestError("hobliId is required");
  validObjectId(hobliId, "hobliId");
  await hobliService.getById(hobliId); // 404 if hobli not found
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  return await villageController.listVillagesByHobli(hobliId, filters, pagination);
});

// -------- Village (under District → Taluka → Hobli) --------
exports.createVillage = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.villageCreate)(event);
  return await villageController.createVillage(body);
});

exports.listVillages = asyncHandler(async (event) => {
  await ensureDb();
  const q = event.queryStringParameters || {};
  const hobliIdentifier = q.hobli || q.hobliId || null;
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  if (hobliIdentifier && require("mongoose").Types.ObjectId.isValid(hobliIdentifier)) {
    return await villageController.listVillagesByHobli(hobliIdentifier, filters, pagination);
  }
  return await villageController.listVillages(filters, pagination);
});

exports.getVillage = asyncHandler(async (event) => {
  await ensureDb();
  const { villageId } = getPathParams(event);
  if (!villageId) throw new BadRequestError("villageId is required");
  validObjectId(villageId, "villageId");
  return await villageController.getVillage(villageId);
});

exports.updateVillage = asyncHandler(async (event) => {
  await ensureDb();
  const { villageId } = getPathParams(event);
  validObjectId(villageId, "villageId");
  const body = validate(schemas.villageUpdate)(event);
  return await villageController.updateVillage(villageId, body);
});

// -------- CAD Center (auth: Super Admin or Admin) --------
exports.createCadCenter = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const body = validate(schemas.cadCenterCreate)(event);
  return await cadCenterController.createCadCenter(body, user);
});

exports.listCadCenters = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const filters = getQueryParams(event);
  const pagination = getPagination(event);
  const q = event.queryStringParameters || {};
  const includeAssignmentCounts = q.includeAssignmentCounts === "true" || q.includeAssignmentCounts === true;
  return await cadCenterController.listCadCenters(filters, pagination, {
    includeAssignmentCounts,
  });
});

exports.getCadCenter = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { cadCenterId } = getPathParams(event);
  if (!cadCenterId) throw new BadRequestError("cadCenterId is required");
  validObjectId(cadCenterId, "cadCenterId");
  const q = event.queryStringParameters || {};
  const includeAssignments = q.includeAssignments === "true" || q.includeAssignments === true;
  return await cadCenterController.getCadCenter(cadCenterId, { includeAssignments });
});

exports.updateCadCenter = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { cadCenterId } = getPathParams(event);
  if (!cadCenterId) throw new BadRequestError("cadCenterId is required");
  validObjectId(cadCenterId, "cadCenterId");
  const body = validate(schemas.cadCenterUpdate)(event);
  return await cadCenterController.updateCadCenter(cadCenterId, body);
});

exports.deleteCadCenter = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { cadCenterId } = getPathParams(event);
  if (!cadCenterId) throw new BadRequestError("cadCenterId is required");
  validObjectId(cadCenterId, "cadCenterId");
  return await cadCenterController.deleteCadCenter(cadCenterId);
});
