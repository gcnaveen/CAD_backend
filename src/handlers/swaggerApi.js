/**
 * Swagger API Router (Single Lambda)
 * Routes documentation endpoints to swaggerHandler.
 */

const { BadRequestError } = require("../utils/errors");
const asyncHandler = require("../utils/asyncHandler");
const swaggerHandler = require("./swaggerHandler");

function optionsResponse() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

/**
 * Single entrypoint for all Swagger documentation endpoints.
 */
exports.handler = asyncHandler(async (event) => {
  const routeKey =
    event.routeKey ||
    `${(event.requestContext?.http?.method || event.httpMethod || "GET").toUpperCase()} ${event.rawPath || event.path || event.requestContext?.http?.path || ""}`.trim();

  switch (routeKey) {
    case "GET /api/docs":
      return swaggerHandler.getSwaggerUI(event);
    case "GET /api/docs/swagger.yaml":
      return swaggerHandler.getSwaggerYaml(event);
    case "GET /api/docs/swagger.json":
      return swaggerHandler.getSwaggerJson(event);
    case "OPTIONS /api/docs":
    case "OPTIONS /api/docs/swagger.yaml":
    case "OPTIONS /api/docs/swagger.json":
      return optionsResponse();
    default:
      throw new BadRequestError(`Unsupported route: ${routeKey}`);
  }
});
