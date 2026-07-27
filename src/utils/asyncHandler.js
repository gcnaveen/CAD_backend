/**
 * Async Handler Wrapper — correlation ID + structured errors (M-07).
 */

const logger = require("./logger");
const { error } = require("./response");
const { applySecurityHeaders } = require("./httpSecurity");
const {
  runWithRequestContext,
  extractIncomingCorrelationId,
} = require("./requestContext");
const { AppError } = require("./errors");
const { HTTP_STATUS } = require("../config/constants");

function withCorrelationHeader(event, result, correlationId) {
  if (!result || typeof result !== "object") return result;
  const headers = { ...(result.headers || {}) };
  headers["x-correlation-id"] = correlationId;
  return applySecurityHeaders(event, { ...result, headers });
}

const asyncHandler = (fn) => {
  return async (event, context) => {
    const correlationId = extractIncomingCorrelationId(event);
    const awsRequestId = context?.awsRequestId || event?.requestContext?.requestId || null;

    return runWithRequestContext({ correlationId, awsRequestId }, async () => {
      try {
        const result = await fn(event, context);
        return withCorrelationHeader(event, result, correlationId);
      } catch (err) {
        const method = event?.requestContext?.http?.method || event?.httpMethod;
        const path = event?.rawPath || event?.path || event?.requestContext?.http?.path;

        logger.error("Unhandled error in async handler", err, {
          path,
          method,
          requestId: awsRequestId,
          correlationId,
        });

        if (err instanceof AppError) {
          return withCorrelationHeader(
            event,
            error({
              statusCode: err.statusCode,
              message: err.message,
              errors: err.errors || null,
              code: err.code,
            }),
            correlationId
          );
        }

        if (err.name === "ValidationError") {
          const validationErrors = Object.values(err.errors || {}).map((e) => ({
            field: e.path,
            message: e.message,
          }));
          return withCorrelationHeader(
            event,
            error({
              statusCode: HTTP_STATUS.BAD_REQUEST,
              message: "Validation failed",
              errors: validationErrors,
            }),
            correlationId
          );
        }

        if (
          err.name === "MongoServerError" ||
          err.name === "MongooseError" ||
          err.name === "MongoError" ||
          err.name === "MongoNetworkError" ||
          err.name === "MongoTimeoutError" ||
          err.name === "MongooseServerSelectionError"
        ) {
          logger.error("MongoDB error details", err, {
            code: err.code,
            codeName: err.codeName,
            correlationId,
          });

          if (err.name === "MongooseServerSelectionError" || err.message?.includes("timed out")) {
            return withCorrelationHeader(
              event,
              error({
                statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
                message:
                  "Database connection timeout - check Lambda VPC configuration and network access",
                code: "DB_CONNECTION_TIMEOUT",
                errors: [
                  {
                    message:
                      err.message ||
                      "Unable to reach MongoDB. Ensure Lambda has internet access or is configured with NAT Gateway if in VPC.",
                  },
                ],
              }),
              correlationId
            );
          }

          return withCorrelationHeader(
            event,
            error({
              statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
              message: "Database error occurred",
              code: "DB_ERROR",
              errors: [{ message: err.message || "Database operation failed" }],
            }),
            correlationId
          );
        }

        if (err.name === "CastError") {
          return withCorrelationHeader(
            event,
            error({
              statusCode: HTTP_STATUS.BAD_REQUEST,
              message: `Invalid ${err.path || "value"}`,
              code: "VALIDATION_ERROR",
              errors: [{ field: err.path, message: err.message }],
            }),
            correlationId
          );
        }

        if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
          return withCorrelationHeader(
            event,
            error({
              statusCode: HTTP_STATUS.UNAUTHORIZED,
              message: "Invalid or expired token",
              code: "AUTH_INVALID_TOKEN",
            }),
            correlationId
          );
        }

        const exposeDetail = process.env.NODE_ENV !== "production";
        return withCorrelationHeader(
          event,
          error({
            statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            message: exposeDetail && err?.message ? err.message : "An unexpected error occurred",
            code: "UNEXPECTED_ERROR",
            errors: exposeDetail && err?.message ? [{ message: err.message }] : null,
          }),
          correlationId
        );
      }
    });
  };
};

module.exports = asyncHandler;
