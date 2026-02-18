const { json } = require("../utils/response");
const { connectToDatabase } = require("../config/db");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

/**
 * GET /test
 * Smoke test endpoint + DB connectivity check.
 */
module.exports.handler = async (event) => {
  const requestId = event?.requestContext?.requestId;
  const startedAt = Date.now();

  await connectToDatabase();

  // Force a tiny write so MongoDB actually creates DB/collection (Mongo is lazy).
  const db = mongoose.connection.db;
  await db.collection("health_checks").updateOne(
    { _id: "api:test" },
    {
      $set: {
        updatedAt: new Date(),
        stage: process.env.STAGE,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  const responseBody = {
    ok: true,
    service: "cad-backend-api",
    stage: process.env.STAGE,
    time: new Date().toISOString(),
    requestId,
    query: event?.queryStringParameters ?? {},
    dbConnected: mongoose.connection.readyState === 1,
    dbName: db.databaseName,
  };

  logger.info("testApi ok", {
    requestId,
    dbName: db.databaseName,
    durationMs: Date.now() - startedAt,
  });

  return json(200, responseBody);
};

