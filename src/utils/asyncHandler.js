/**
 * Async Handler Wrapper
 * Wraps async route handlers to automatically catch errors
 */

const logger = require('./logger');
const { error } = require('./response');
const { AppError, DatabaseError } = require('./errors');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Wraps async function to catch errors and return appropriate response
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
const asyncHandler = (fn) => {
  return async (event, context) => {
    try {
      return await fn(event, context);
    } catch (err) {
      const method = event?.requestContext?.http?.method || event?.httpMethod;
      const path = event?.rawPath || event?.path || event?.requestContext?.http?.path;
      const requestId = context?.awsRequestId || event?.requestContext?.requestId;

      // Log the error with more details
      logger.error('Unhandled error in async handler', err, {
        path,
        method,
        requestId,
        errorName: err?.name,
        errorMessage: err?.message,
        errorStack: err?.stack,
      });

      // Handle known application errors
      if (err instanceof AppError) {
        return error({
          statusCode: err.statusCode,
          message: err.message,
          errors: err.errors || null,
          code: err.code,
        });
      }

      // Handle database errors
      if (err.name === 'ValidationError') {
        const validationErrors = Object.values(err.errors || {}).map(e => ({
          field: e.path,
          message: e.message
        }));
        
        return error({
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: 'Validation failed',
          errors: validationErrors,
        });
      }

      if (err.name === 'MongoServerError' || err.name === 'MongooseError' || err.name === 'MongoError' || err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError' || err.name === 'MongooseServerSelectionError') {
        logger.error('MongoDB error details', err, {
          code: err.code,
          codeName: err.codeName,
          errorLabels: err.errorLabels,
          reason: err.reason?.message,
        });
        
        // Check for connection timeout - likely VPC/network issue
        if (err.name === 'MongooseServerSelectionError' || err.message?.includes('timed out')) {
          return error({
            statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
            message: 'Database connection timeout - check Lambda VPC configuration and network access',
            code: "DB_CONNECTION_TIMEOUT",
            errors: [{ 
              message: err.message || 'Unable to reach MongoDB. Ensure Lambda has internet access or is configured with NAT Gateway if in VPC.',
              hint: 'If Lambda is in a VPC, ensure NAT Gateway is configured for internet access, or remove VPC configuration if not needed.'
            }],
          });
        }
        
        return error({
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          message: 'Database error occurred',
          code: "DB_ERROR",
          errors: [{ message: err.message || 'Database operation failed' }],
        });
      }

      // Handle CastError (invalid ObjectId, etc.)
      if (err.name === 'CastError') {
        return error({
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: `Invalid ${err.path || 'value'}`,
          code: "VALIDATION_ERROR",
          errors: [{ field: err.path, message: err.message }],
        });
      }

      // Handle JWT errors
      if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return error({
          statusCode: HTTP_STATUS.UNAUTHORIZED,
          message: 'Invalid or expired token',
          code: "AUTH_INVALID_TOKEN",
        });
      }

      // Handle unknown errors
      return error({
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
        code: "UNEXPECTED_ERROR",
      });
    }
  };
};

module.exports = asyncHandler;