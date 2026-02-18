# Lambda MongoDB Connection Timeout Fix

## Problem
"Server selection timed out after 10000 ms" - Lambda cannot reach MongoDB Atlas.

## Root Cause
Lambda function doesn't have internet access. This happens when:
1. Lambda is configured with VPC but no NAT Gateway
2. Security Groups blocking outbound connections
3. Network ACLs blocking traffic

## Solutions

### Option 1: Remove VPC Configuration (Recommended if VPC not needed)

1. Go to AWS Lambda Console
2. Select your function (e.g., `cad-backend-api-dev-authApi`)
3. Go to **Configuration** → **VPC**
4. If VPC is configured, click **Edit** → **Remove VPC configuration**
5. Save and redeploy

### Option 2: Configure NAT Gateway (If VPC is required)

If Lambda must be in VPC:

1. **Create NAT Gateway:**
   - Go to VPC Console → NAT Gateways
   - Create NAT Gateway in public subnet
   - Allocate Elastic IP
   - Note the NAT Gateway ID

2. **Update Route Table:**
   - Go to Route Tables
   - Find route table for Lambda's private subnet
   - Add route: `0.0.0.0/0` → NAT Gateway

3. **Update Security Group:**
   - Ensure outbound rules allow HTTPS (443) and MongoDB (27017)
   - Allow all outbound traffic: `0.0.0.0/0` on all ports (for testing)

### Option 3: Use MongoDB SRV Connection String

Try using SRV connection string instead of replica set:

1. Update Lambda environment variable:
   ```
   MONGODB_URI=mongodb+srv://cad_db_user:caduser%40123@cadstaging.gntbdiw.mongodb.net/cad_db?retryWrites=true&w=majority&appName=cadstaging
   ```

2. Remove or set to false:
   ```
   MONGODB_DISCOVER_PRIMARY=false
   ```

### Option 4: Use MongoDB Atlas Private Endpoint (For Production)

If using VPC, configure MongoDB Atlas Private Endpoint:
1. MongoDB Atlas → Network Access → Private Endpoint
2. Create Private Endpoint
3. Configure VPC Peering
4. Update connection string to use private endpoint

## Quick Check

Run this in AWS Lambda Test:
```javascript
const https = require('https');
exports.handler = async (event) => {
  return new Promise((resolve) => {
    https.get('https://www.google.com', (res) => {
      resolve({ statusCode: 200, body: 'Internet access: OK' });
    }).on('error', (err) => {
      resolve({ statusCode: 500, body: `No internet: ${err.message}` });
    });
  });
};
```

If this fails, Lambda has no internet access → Fix VPC/NAT Gateway.

## Current Configuration

Your `.env` shows:
- `MONGODB_DISCOVER_PRIMARY=true` - This tries to discover primary node
- `MONGODB_URI_STANDARD` - Replica set connection string

Try disabling discovery first:
```
MONGODB_DISCOVER_PRIMARY=false
```

Or use SRV connection string instead.
