# MongoDB Atlas Setup Guide - New Account

## Step 1: Create/Configure MongoDB Atlas Cluster

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign in to your **new account**
3. Create a new cluster (or use existing)
4. Wait for cluster to be ready

## Step 2: Create Database User

1. Go to **Database Access** → **Add New Database User**
2. Choose **Password** authentication
3. Set username and password (remember these!)
4. Set user privileges: **Read and write to any database** (or specific database)
5. Click **Add User**

## Step 3: Configure Network Access (IP Whitelist)

1. Go to **Network Access** → **Add IP Address**
2. For Lambda access, add: `0.0.0.0/0` (allows all IPs)
   - Or add specific AWS Lambda IP ranges if you know them
3. Click **Confirm**

## Step 4: Get Connection String

1. Go to **Database** → Click **Connect** on your cluster
2. Choose **Connect your application**
3. Select **Node.js** and version **5.5 or later**
4. Copy the connection string

You'll get two options:

### Option A: SRV Connection String (Recommended)
```
mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority&appName=<app-name>
```

### Option B: Standard Connection String
```
mongodb://<username>:<password>@<cluster>-shard-00-00.xxxxx.mongodb.net:27017,<cluster>-shard-00-01.xxxxx.mongodb.net:27017,<cluster>-shard-00-02.xxxxx.mongodb.net:27017/<database>?ssl=true&replicaSet=atlas-xxxxx-shard-0&authSource=admin&retryWrites=true&w=majority&appName=<app-name>
```

## Step 5: Update Your Configuration

### For Local Development (.env file)

Update `.env` file:

```env
# Option 1: Use SRV connection string (Recommended)
MONGODB_URI=mongodb+srv://your_username:your_password@your-cluster.mongodb.net/cad_db?retryWrites=true&w=majority&appName=cadstaging

# Option 2: Use Standard connection string
# MONGODB_URI_STANDARD=mongodb://username:password@cluster-shard-00-00.xxxxx.mongodb.net:27017,cluster-shard-00-01.xxxxx.mongodb.net:27017,cluster-shard-00-02.xxxxx.mongodb.net:27017/cad_db?ssl=true&replicaSet=atlas-xxxxx-shard-0&authSource=admin&retryWrites=true&w=majority&appName=cadstaging

# Disable primary discovery for Lambda
MONGODB_DISCOVER_PRIMARY=false
```

**Important:** URL encode special characters in password:
- `@` becomes `%40`
- `#` becomes `%23`
- `%` becomes `%25`
- `:` becomes `%3A`
- `/` becomes `%2F`
- `?` becomes `%3F`
- `=` becomes `%3D`
- `&` becomes `%26`

### For AWS Lambda (Environment Variables)

Update Lambda environment variables in AWS Console or via serverless.yml:

1. **Via AWS Console:**
   - Go to Lambda → Your function → Configuration → Environment variables
   - Update `MONGODB_URI` or `MONGODB_URI_STANDARD`
   - Update `MONGODB_DISCOVER_PRIMARY=false`

2. **Via serverless.yml:**
   - Update environment variables section
   - Redeploy: `serverless deploy --stage dev`

## Step 6: Test Connection

1. Test locally:
   ```bash
   npm run dev
   # Test endpoint: GET http://localhost:3000/test
   ```

2. Test in Lambda:
   - Deploy: `serverless deploy --stage dev`
   - Test endpoint: `GET https://your-api.execute-api.ap-south-1.amazonaws.com/test`

## Troubleshooting

### Connection Timeout
- Check IP whitelist includes `0.0.0.0/0` or Lambda IPs
- Verify username/password are correct
- Check if Lambda has internet access (VPC/NAT Gateway)

### Authentication Failed
- Verify username and password
- Check URL encoding of special characters
- Ensure database user has correct privileges

### SSL/TLS Errors
- Ensure connection string includes `ssl=true` or uses `mongodb+srv://`
- Check MongoDB Atlas cluster is running

## Example .env Configuration

```env
# New MongoDB Atlas Account - SRV Connection
MONGODB_URI=mongodb+srv://newuser:newpassword123@newcluster.mongodb.net/cad_db?retryWrites=true&w=majority&appName=cadstaging
MONGODB_DISCOVER_PRIMARY=false

# Keep other settings
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=24h
```
