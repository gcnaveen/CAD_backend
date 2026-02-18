# Viewing Logs

## Local (serverless-offline)

Logs are printed to your terminal running:

```bash
npx serverless offline start
```

## AWS (deployed)

Serverless/Lambda logs go to **CloudWatch Logs**:

- CloudWatch → Logs → Log groups → `/aws/lambda/<service>-<stage>-<functionName>`

## Logging style

We use structured logging via `src/utils/logger.js`.

- In production: JSON logs (best for CloudWatch Insights / log aggregation)
- In dev: readable lines

