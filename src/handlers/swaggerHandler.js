/**
 * Swagger Documentation Handler
 * Serves Swagger UI HTML and OpenAPI spec with runtime base URL injection
 * for correct spec loading behind API Gateway / custom domains.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const PLACEHOLDER_SPEC_URL = "__SWAGGER_SPEC_URL__";

/**
 * Resolve base URL from Lambda event (API Gateway HTTP API / serverless-offline).
 * Prefers Host header so the spec URL matches the page origin (avoids CORS with serverless-offline).
 */
function getBaseUrl(event) {
  const requestContext = event?.requestContext || {};
  const hostHeader = event?.headers?.host || event?.headers?.Host || "";
  const ctxDomain = requestContext?.domainName || "";

  // Prefer Host header so Swagger UI fetches the spec from the same origin as the page.
  // Serverless-offline often sets domainName to a placeholder (e.g. offlineContext_domainName);
  // treat that as invalid and use Host or localhost.
  const isInvalidDomain =
    !ctxDomain || /offline|domainname|\$default/i.test(String(ctxDomain));
  const host = hostHeader || (isInvalidDomain ? "localhost:3000" : ctxDomain);

  const protocol =
    event?.headers?.["x-forwarded-proto"] ||
    event?.headers?.["X-Forwarded-Proto"] ||
    (String(host).includes("localhost") ? "http" : "https");

  let baseUrl = `${protocol}://${host}`;
  const stage = requestContext?.stage || "dev";
  if (
    !String(host).includes("localhost") &&
    !String(host).includes("amazonaws.com")
  ) {
    baseUrl = `${baseUrl}/${stage}`;
  }
  return baseUrl;
}

/**
 * GET /api/docs/swagger.yaml — serve OpenAPI spec.
 */
async function getSwaggerYaml() {
  const filePath = path.join(ROOT, "swagger.yaml");
  const content = await fs.readFile(filePath, "utf8");
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/x-yaml; charset=utf-8",
      "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control":
        process.env.NODE_ENV === "production"
          ? "public, max-age=300"
          : "public, max-age=60",
    },
    body: content,
  };
}

/**
 * GET /api/docs/swagger.json — serve OpenAPI spec as JSON (avoids YAML parsing issues in some UIs).
 */
async function getSwaggerJson() {
  const filePath = path.join(ROOT, "swagger.yaml");
  const content = await fs.readFile(filePath, "utf8");
  const spec = yaml.load(content);
  if (!spec.openapi && !spec.swagger) {
    spec.openapi = "3.1.0";
  } else if (typeof spec.openapi === "number") {
    spec.openapi = String(spec.openapi);
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control":
        process.env.NODE_ENV === "production"
          ? "public, max-age=300"
          : "public, max-age=60",
    },
    body: JSON.stringify(spec),
  };
}

/**
 * GET /api/docs — serve Swagger UI HTML with spec URL injected for current host.
 */
async function getSwaggerUI(event) {
  const baseUrl = getBaseUrl(event);
  const specUrl = `${baseUrl}/api/docs/swagger.json`;

  const filePath = path.join(ROOT, "swagger.html");
  let htmlContent = await fs.readFile(filePath, "utf8");

  htmlContent = htmlContent.replace(PLACEHOLDER_SPEC_URL, specUrl);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=60",
    },
    body: htmlContent,
  };
}

module.exports = {
  getSwaggerYaml,
  getSwaggerJson,
  getSwaggerUI,
  PLACEHOLDER_SPEC_URL,
};
