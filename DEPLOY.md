# Deploy CAD Backend API to AWS Lambda

This guide covers deploying the API to AWS and configuring it in the AWS Console.

---

## 1. Prerequisites

- **Node.js** 20.x (matches Lambda runtime)
- **AWS CLI** v2 installed and configured
- **AWS account** with permissions for Lambda, API Gateway (HTTP API), IAM, CloudWatch

### Configure AWS CLI (if not done)

```bash
aws configure
# Enter: AWS Access Key ID, Secret Access Key, default region (e.g. ap-south-1)
```

---

## 2. Set environment variables for deployment

Your Lambda needs `MONGODB_URI` and `JWT_SECRET` at runtime. They are read from your **local** environment (or `.env`) when you run `serverless deploy` and baked into the deployed config.

**Option A – Use a `.env` file (do not commit `.env` to git)**

Create or edit `.env` in the project root. Lambda only receives the variables listed in `serverless.yml`; `MONGODB_DISCOVER_PRIMARY` is **not** sent to AWS (it is for local use only).

```env
# Use one of these. MONGODB_URI_STANDARD is preferred if SRV fails in your environment.
MONGODB_URI_STANDARD=mongodb://user:pass@host1:27017,host2:27017,host3:27017/cad_db?ssl=true&replicaSet=...&authSource=admin
# OR (SRV works from Lambda in most regions):
# MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/cad_db?retryWrites=true&w=majority

JWT_SECRET=your-strong-secret-for-production
JWT_EXPIRES_IN=24h
```

With `useDotenv: true` in `serverless.yml`, these values are used when you run `serverless deploy`.

**Option B – Export in the shell (for CI or one-off deploy)**

```bash
export MONGODB_URI=mongodb+srv://...
export JWT_SECRET=your-strong-secret
npm run deploy:dev
```

**Production tip:** Prefer AWS Systems Manager Parameter Store or Secrets Manager and reference them in `serverless.yml` instead of storing secrets in `.env`.

**If you get `querySrv ECONNREFUSED` (Lambda or restricted DNS):** Use the **Standard** (non-SRV) connection string so MongoDB doesn’t need SRV DNS. In Atlas: **Database** → **Connect** → **Drivers** → choose **Node.js** → copy the **“Standard connection string”** (hosts like `cluster-shard-00-00.xxxxx.mongodb.net:27017,...`). Put it in `.env` as `MONGODB_URI_STANDARD=...` (and keep or remove `MONGODB_URI`). The app uses `MONGODB_URI_STANDARD` when set.

---

## 3. Deploy to AWS

From the project root:

```bash
# Install dependencies (if not already)
npm install

# Deploy to dev stage (ap-south-1 by default)
npm run deploy:dev

# Or deploy to production
npm run deploy:prod

# Deploy to a specific region
npx serverless deploy --stage dev --region us-east-1
```

Deployment will:

- Create or update the **HTTP API** in API Gateway
- Create or update **Lambda functions**: `authApi`, `testApi`, `swaggerApi`
- Set environment variables on each function

At the end you’ll see output similar to:

```text
endpoints:
  GET - https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/api/docs
  GET - https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/api/docs/swagger.yaml
  POST - https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/api/auth/login
  ...
```

Copy the **base URL** (e.g. `https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com`) for testing and for Swagger.

---

## 4. Verify in AWS Console

### Lambda

1. Open **AWS Console** → **Lambda** → **Functions**.
2. You should see (stage prefix may vary):
   - `cad-backend-api-dev-authApi`
   - `cad-backend-api-dev-testApi`
   - `cad-backend-api-dev-swaggerApi`
3. Click a function → **Configuration** → **Environment variables** to confirm `MONGODB_URI`, `JWT_SECRET`, `STAGE`, `NODE_ENV`.

### API Gateway

1. Go to **API Gateway** → **APIs**.
2. Open the **HTTP API** created for this service (name will include `cad-backend-api` and the stage).
3. Check **Routes** for `/api/docs`, `/api/docs/swagger.yaml`, `/api/auth/*`, `/test`.
4. **Stages** → select your stage (e.g. `dev`) to see the **Invoke URL** (this is the base URL from deploy output).

### Swagger UI

- Open: `https://<your-api-id>.execute-api.ap-south-1.amazonaws.com/api/docs`
- The page will load the spec from the same host, so “Try it out” will call your deployed API.

---

## 5. Optional: Update OpenAPI “servers” for production

To show the real API URL in Swagger’s server dropdown, set it in `swagger.yaml` after first deploy:

```yaml
servers:
  - url: https://YOUR_API_ID.execute-api.ap-south-1.amazonaws.com
    description: Production (API Gateway)
```

Replace `YOUR_API_ID` with the ID from the deploy output or from API Gateway.

---

## 6. MongoDB for production

- Lambda must reach your MongoDB (e.g. **Atlas** or a VPC-hosted cluster).
- For **Atlas**: use the connection string (e.g. `mongodb+srv://...`) in `MONGODB_URI` and ensure Atlas Network Access allows the Lambda IPs or use VPC peering.
- For **VPC**: put the Lambda in the same VPC as MongoDB and set `MONGODB_URI` to the internal host.

---

## 7. Useful commands

| Command | Description |
|--------|-------------|
| `npm run deploy:dev` | Deploy to stage `dev` |
| `npm run deploy:prod` | Deploy to stage `prod` |
| `npx serverless info --stage dev` | Show endpoints and resource info |
| `npx serverless logs -f authApi --stage dev` | Tail logs for `authApi` |
| `npx serverless remove --stage dev` | Remove the stack for `dev` |

---

## 8. Troubleshooting

### "unable to verify the first certificate" during deploy

If you see this error, your network/proxy is blocking TLS verification. Use the insecure deploy script:

```bash
npm run deploy:dev:insecure
```

This disables certificate verification **only for the deploy process** (your machine → AWS), not for Lambda runtime.

### "Stack is in UPDATE_ROLLBACK_FAILED state"

If CloudFormation stack gets stuck in `UPDATE_ROLLBACK_FAILED`:

1. **AWS Console** → **CloudFormation** → **Stacks**
2. Select `cad-backend-api-dev`
3. **Stack actions** → **Continue update rollback**
4. Skip any resources that failed (e.g., Lambda functions)
5. Continue, then redeploy: `npm run deploy:dev:insecure`

Alternatively, delete the stack manually and redeploy fresh.

### "Lambda function could not be found"

This usually means the CloudFormation stack is in a bad state. Follow the steps above to fix `UPDATE_ROLLBACK_FAILED`, or delete and recreate the stack.

---

## 9. Summary checklist

- [ ] AWS CLI configured (`aws configure`)
- [ ] One of `MONGODB_URI` or `MONGODB_URI_STANDARD` set in `.env` (or exported) for deploy
- [ ] `JWT_SECRET` set (use a strong secret for production)
- [ ] Do **not** add `MONGODB_DISCOVER_PRIMARY` to Lambda (it is for local use only; not in `serverless.yml`)
- [ ] `npm install` and `npm run deploy:dev` (or `deploy:prod`) run successfully
- [ ] Endpoints and Lambda functions visible in AWS Console
- [ ] `/api/docs` and `/test` return 200 in browser or `curl`
- [ ] Auth endpoints (e.g. `/api/auth/login`) tested with real credentials
