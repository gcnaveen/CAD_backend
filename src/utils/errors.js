const { HTTP_STATUS } = require("../config/constants");

/**
 * Enterprise-friendly error types.
 *
 * - AppError: base class with statusCode + optional `code` + `errors` array/object
 * - Typed subclasses for common HTTP errors
 */

class AppError extends Error {
  constructor(message, { statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, code, errors } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }
}

class BadRequestError extends AppError {
  constructor(message = "Bad Request", opts = {}) {
    super(message, { statusCode: HTTP_STATUS.BAD_REQUEST, ...opts });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", opts = {}) {
    super(message, { statusCode: HTTP_STATUS.UNAUTHORIZED, ...opts });
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Forbidden", opts = {}) {
    super(message, { statusCode: HTTP_STATUS.FORBIDDEN, ...opts });
  }
}

class NotFoundError extends AppError {
  constructor(message = "Not Found", opts = {}) {
    super(message, { statusCode: HTTP_STATUS.NOT_FOUND, ...opts });
  }
}

class ConflictError extends AppError {
  constructor(message = "Conflict", opts = {}) {
    super(message, { statusCode: HTTP_STATUS.CONFLICT, ...opts });
  }
}

class DatabaseError extends AppError {
  constructor(message = "Database error occurred", cause, opts = {}) {
    super(message, { statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR, ...opts });
    this.cause = cause;
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  DatabaseError,
};

