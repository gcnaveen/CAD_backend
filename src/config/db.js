/**
 * DB adapter to keep imports stable across the codebase.
 *
 * Prefer importing from `src/config/db.js` everywhere so the underlying
 * implementation (`database.js`) can evolve without changing callers.
 */

const { connectDB, disconnectDB, mongoose } = require("./database");

// Back-compat alias used by `testApi`
async function connectToDatabase() {
  return connectDB();
}

module.exports = {
  connectDB,
  disconnectDB,
  connectToDatabase,
  mongoose,
};

