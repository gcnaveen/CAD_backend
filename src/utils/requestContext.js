/**
 * Per-invocation request context (correlation ID) for structured logs (M-07).
 */

const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const als = new AsyncLocalStorage();

function newCorrelationId() {
  return crypto.randomBytes(12).toString("hex");
}

function extractIncomingCorrelationId(event) {
  const headers = event?.headers || {};
  const raw =
    headers["x-correlation-id"] ||
    headers["X-Correlation-Id"] ||
    headers["x-request-id"] ||
    headers["X-Request-Id"] ||
    event?.requestContext?.requestId ||
    null;
  if (!raw) return newCorrelationId();
  return String(raw).trim().slice(0, 128) || newCorrelationId();
}

function runWithRequestContext(store, fn) {
  return als.run(store, fn);
}

function getRequestContext() {
  return als.getStore() || null;
}

function getCorrelationId() {
  return als.getStore()?.correlationId || null;
}

/** Browser Origin from the initiating request (PhonePe return host / CORS). */
function getRequestOrigin() {
  return als.getStore()?.origin || null;
}

module.exports = {
  newCorrelationId,
  extractIncomingCorrelationId,
  runWithRequestContext,
  getRequestContext,
  getCorrelationId,
  getRequestOrigin,
};
