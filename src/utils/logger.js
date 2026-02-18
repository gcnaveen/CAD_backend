/**
 * Structured logger (CloudWatch friendly).
 *
 * - In production: logs JSON objects (best for log aggregation)
 * - In local/dev: logs readable lines
 */

const isProduction = process.env.NODE_ENV === "production";
const isDev = !isProduction;

const LEVELS = Object.freeze({
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
});

function baseMeta(meta) {
  // ensure meta is a plain object
  if (!meta || typeof meta !== "object") return {};
  return meta;
}

function format(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...baseMeta(meta),
  };

  if (isProduction) return JSON.stringify(entry);

  const metaStr = Object.keys(entry).some((k) => !["time", "level", "message"].includes(k))
    ? ` ${JSON.stringify(baseMeta(meta))}`
    : "";
  return `[${entry.time}] ${entry.level}: ${entry.message}${metaStr}`;
}

function errorToMeta(err) {
  if (!err) return undefined;
  return {
    error: {
      name: err.name,
      message: err.message,
      stack: isDev ? err.stack : undefined,
    },
  };
}

const logger = {
  error(message, err, meta = {}) {
    // eslint-disable-next-line no-console
    console.error(format(LEVELS.ERROR, message, { ...meta, ...errorToMeta(err) }));
  },
  warn(message, meta = {}) {
    // eslint-disable-next-line no-console
    console.warn(format(LEVELS.WARN, message, meta));
  },
  info(message, meta = {}) {
    // eslint-disable-next-line no-console
    console.log(format(LEVELS.INFO, message, meta));
  },
  debug(message, meta = {}) {
    if (!isDev) return;
    // eslint-disable-next-line no-console
    console.log(format(LEVELS.DEBUG, message, meta));
  },
};

module.exports = logger;

