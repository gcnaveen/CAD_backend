/**
 * Masters API Router – District → Taluka → Hobli hierarchy.
 * RouteKey format: METHOD /path with {param} as in API Gateway HTTP API.
 */

const { BadRequestError } = require("../utils/errors");
const asyncHandler = require("../utils/asyncHandler");
const mastersHandler = require("./masters.handler");

exports.handler = asyncHandler(async (event) => {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "";
  const routeKey =
    event.routeKey ||
    `${(event.requestContext?.http?.method || "").toUpperCase()} ${path}`.trim();

  switch (routeKey) {
    case "POST /api/masters/districts":
      return mastersHandler.createDistrict(event);
    case "GET /api/masters/districts":
      return mastersHandler.listDistricts(event);
    case "GET /api/masters/districts/{districtId}":
      return mastersHandler.getDistrict(event);
    case "PATCH /api/masters/districts/{districtId}":
      return mastersHandler.updateDistrict(event);
    case "GET /api/masters/districts/{districtId}/talukas":
      return mastersHandler.listTalukasByDistrict(event);

    case "POST /api/masters/talukas":
      return mastersHandler.createTaluka(event);
    case "GET /api/masters/talukas":
      return mastersHandler.listTalukas(event);
    case "GET /api/masters/talukas/{talukaId}":
      return mastersHandler.getTaluka(event);
    case "PATCH /api/masters/talukas/{talukaId}":
      return mastersHandler.updateTaluka(event);
    case "GET /api/masters/talukas/{talukaId}/hoblis":
      return mastersHandler.listHoblisByTaluka(event);

    case "POST /api/masters/hoblis":
      return mastersHandler.createHobli(event);
    case "GET /api/masters/hoblis":
      return mastersHandler.listHoblis(event);
    case "GET /api/masters/hoblis/{hobliId}":
      return mastersHandler.getHobli(event);
    case "PATCH /api/masters/hoblis/{hobliId}":
      return mastersHandler.updateHobli(event);
    case "GET /api/masters/hoblis/{hobliId}/villages":
      return mastersHandler.listVillagesByHobli(event);

    case "POST /api/masters/villages":
      return mastersHandler.createVillage(event);
    case "GET /api/masters/villages":
      return mastersHandler.listVillages(event);
    case "GET /api/masters/villages/{villageId}":
      return mastersHandler.getVillage(event);
    case "PATCH /api/masters/villages/{villageId}":
      return mastersHandler.updateVillage(event);

    case "POST /api/masters/cad-centers":
      return mastersHandler.createCadCenter(event);
    case "GET /api/masters/cad-centers":
      return mastersHandler.listCadCenters(event);
    case "GET /api/masters/cad-centers/{cadCenterId}":
      return mastersHandler.getCadCenter(event);
    case "PATCH /api/masters/cad-centers/{cadCenterId}":
      return mastersHandler.updateCadCenter(event);
    case "DELETE /api/masters/cad-centers/{cadCenterId}":
      return mastersHandler.deleteCadCenter(event);

    default:
      throw new BadRequestError(`Unsupported route: ${routeKey}`);
  }
});
