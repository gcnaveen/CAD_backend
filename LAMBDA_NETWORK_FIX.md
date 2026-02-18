# Lambda Network Fix - Database Works Locally

## Problem
- ✅ Database connects fine **locally**
- ❌ Database times out in **Lambda**
- This means: **Lambda doesn't have internet access**

## Solution: Fix Lambda Network Access

### Step 1: Check Lambda VPC Configuration

1. Go to **AWS Lambda Console**
2. Select your function (e.g., `cad-backend-api-dev-authApi`)
3. Go to **Configuration** → **VPC**
4. Check if VPC is configured

### Step 2A: Remove VPC (If Not Needed) - EASIEST FIX

If VPC is not required:
1. Click **Edit** in VPC configuration
2. Select **No VPC** or remove all VPC settings
3. Click **Save**
4. Redeploy: `serverless deploy --stage dev`

**This will give Lambda internet access immediately.**

### Step 2B: Configure NAT Gateway (If VPC Required)

If Lambda MUST be in VPC:

1. **Create NAT Gateway:**
   - VPC Console → NAT Gateways → Create NAT Gateway
   - Select **public subnet**
   - Allocate **Elastic IP**
   - Create

2. **Update Route Table:**
   - Route Tables → Find route table for Lambda's **private subnet**
   - Add route: `0.0.0.0/0` → **NAT Gateway**

3. **Update Security Group:**
   - Security Groups → Find Lambda's security group
   - Outbound rules → Allow **All traffic** to `0.0.0.0/0`

4. Redeploy Lambda

### Step 3: Use SRV Connection String in Lambda

Since your database works locally, use the **same SRV connection string** in Lambda:

1. **Get SRV connection string from MongoDB Atlas:**
   - Database → Connect → Connect your application
   - Copy the `mongodb+srv://` connection string

2. **Update Lambda Environment Variables:**

   **Option A: Via AWS Console**
   - Lambda → Configuration → Environment variables
   - Add/Update:
     ```
     MONGODB_URI=mongodb+srv://cad_db_user:caduser%40123@cadstaging.gntbdiw.mongodb.net/cad_db?retryWrites=true&w=majority&appName=cadstaging
     MONGODB_DISCOVER_PRIMARY=false
     ```
   - Remove or leave empty: `MONGODB_URI_STANDARD`

   **Option B: Via serverless.yml**
   - Update environment variables section
   - Redeploy

### Step 4: Test Connection

After fixing network:
```bash
# Deploy
serverless deploy --stage dev

# Test
curl https://your-api.execute-api.ap-south-1.amazonaws.com/test
```

## Quick Test: Check Lambda Internet Access

Create a test Lambda function to verify internet access:

```javascript
const https = require('https');
exports.handler = async (event) => {
  return new Promise((resolve) => {
    https.get('https://www.google.com', (res) => {
      resolve({ 
        statusCode: 200, 
        body: JSON.stringify({ 
          message: 'Internet access: OK',
          statusCode: res.statusCode 
        })
      });
    }).on('error', (err) => {
      resolve({ 
        statusCode: 500, 
        body: JSON.stringify({ 
          message: 'No internet access',
          error: err.message 
        })
      });
    });
  });
};
```

- If this returns "Internet access: OK" → Lambda has internet, check MongoDB connection string
- If this returns "No internet access" → Fix VPC/NAT Gateway first

## Summary

**Since database works locally:**
1. ✅ Database credentials are correct
2. ✅ Connection string is correct
3. ❌ Lambda needs internet access (VPC/NAT Gateway issue)

**Fix:** Remove VPC from Lambda OR configure NAT Gateway
