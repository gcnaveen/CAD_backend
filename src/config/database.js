
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
// In AWS Lambda, environment variables are injected by the platform.
// Load .env only for local/dev usage.
if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line global-require
  require("dotenv").config();
}

// Prefer SRV URI for Lambda (works better with DNS), fallback to standard URI
// SRV connection strings start with mongodb+srv://
let MONGODB_URI =
  process.env.MONGODB_URI || // SRV connection string (preferred for Lambda)
  process.env.MONGODB_URI_STANDARD || // Standard replica set connection
  `mongodb://${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '27017'}/${process.env.DB_NAME || 'cad_db'}`;

const safeMongoUriForLogs = (uri) => {
  if (!uri) return 'MONGODB_URI is not set';
  return uri.replace(/\/\/([^:/]+):([^@]+)@/g, '//***:***@');
};

/** Parse a mongodb URI into { auth, hosts, pathname, search } for building single-host URIs. */
function parseReplicaSetUri(uri) {
  const m = uri.match(/^mongodb:\/\/([^@]+)@([^/]+)(\/[^?]*)?(\?.*)?$/);
  if (!m) return null;
  const [, auth, hostsStr, pathname = '/cad_db', search = ''] = m;
  const hosts = hostsStr.split(',').map((h) => h.trim());
  if (hosts.length < 2) return null;
  return { auth, hosts, pathname, search };
}

/** Build a single-host URI with directConnection for primary discovery. */
function buildDirectUri(auth, host, pathname, search) {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  params.set('directConnection', 'true');
  params.delete('replicaSet');
  const qs = params.toString();
  return `mongodb://${auth}@${host}${pathname}${qs ? `?${qs}` : ''}`;
}

/** Try each host with directConnection; return the URI of the primary, or null. */
async function discoverPrimaryUri(replicaSetUri) {
  const parsed = parseReplicaSetUri(replicaSetUri);
  if (!parsed) return null;
  const { auth, hosts, pathname, search } = parsed;
  const discoverTimeout = 8000;

  for (const host of hosts) {
    const directUri = buildDirectUri(auth, host, pathname, search);
    let client;
    try {
      client = await MongoClient.connect(directUri, {
        serverSelectionTimeoutMS: discoverTimeout,
        directConnection: true,
      });
      const result = await client.db('admin').command({ isMaster: 1 });
      await client.close();
      if (result && result.ismaster) {
        return directUri;
      }
    } catch (err) {
      if (client) await client.close().catch(() => {});
    }
  }
  return null;
}

// Connection options - optimized for Lambda
const options = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 15000, // Increased for Lambda network latency
  socketTimeoutMS: 45000,
  connectTimeoutMS: 15000, // Increased connection timeout
  // Retry options
  retryWrites: true,
  retryReads: true,
  // DNS options for better Lambda compatibility
  family: 4, // Force IPv4 (better Lambda compatibility)
};

const DISCOVER_PRIMARY = process.env.MONGODB_DISCOVER_PRIMARY === 'true' || process.env.MONGODB_DISCOVER_PRIMARY === '1';

// Connection timeout wrapper for Lambda
const withTimeout = (promise, timeoutMs, errorMessage) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
};

// Test database connection
const connectDB = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log('Database already connected.');
      return;
    }

    let uriToUse = MONGODB_URI;

    // Skip primary discovery in Lambda - it often times out due to network restrictions
    // Use SRV connection string (MONGODB_URI) instead, or ensure Lambda has internet access
    if (DISCOVER_PRIMARY && process.env.MONGODB_URI_STANDARD && parseReplicaSetUri(process.env.MONGODB_URI_STANDARD)) {
      console.log('MONGODB_DISCOVER_PRIMARY is enabled, but skipping in Lambda environment');
      console.log('Tip: Use MONGODB_URI (SRV) instead, or ensure Lambda has internet access via NAT Gateway');
      // Don't try discovery - it will likely timeout
      // Just use the standard URI directly
    }

    console.log('Connecting to MongoDB:', safeMongoUriForLogs(uriToUse));
    console.log('Connection options:', JSON.stringify({
      maxPoolSize: options.maxPoolSize,
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS,
      socketTimeoutMS: options.socketTimeoutMS,
      connectTimeoutMS: options.connectTimeoutMS,
    }));
    
    // Set up error handlers BEFORE connecting
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error event:', {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        codeName: err?.codeName,
      });
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected event fired');
    });

    mongoose.connection.on('connected', () => {
      console.log('MongoDB connected event fired');
    });

    const connectStartTime = Date.now();
    
    // Use timeout wrapper - 15 seconds total timeout
    const connectionTimeout = 15000;
    await withTimeout(
      mongoose.connect(uriToUse, options),
      connectionTimeout,
      `MongoDB connection timed out after ${connectionTimeout}ms`
    );
    
    const connectDuration = Date.now() - connectStartTime;
    
    // Verify connection is actually ready
    if (mongoose.connection.readyState !== 1) {
      throw new Error(`Connection completed but readyState is ${mongoose.connection.readyState} (expected 1)`);
    }
    
    // Test the connection with a simple operation
    try {
      await mongoose.connection.db.admin().ping();
      console.log('MongoDB ping successful');
    } catch (pingError) {
      console.error('MongoDB ping failed:', pingError);
      throw new Error(`Connection established but ping failed: ${pingError.message}`);
    }
    
    console.log(`MongoDB connection established successfully in ${connectDuration}ms.`);
    console.log('Connection state:', mongoose.connection.readyState);
    if (mongoose.connection?.name) {
      console.log('MongoDB database name:', mongoose.connection.name);
    }
  } catch (error) {
    console.error('Unable to connect to MongoDB:', {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      codeName: error?.codeName,
      readyState: mongoose.connection?.readyState,
      stack: error?.stack,
    });
    throw error;
  }
};

// Close database connection
const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    throw error;
  }
};

module.exports = {
  connectDB,
  disconnectDB,
  mongoose
};