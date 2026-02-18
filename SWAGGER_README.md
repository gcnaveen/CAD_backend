# Swagger / OpenAPI Docs

This project serves OpenAPI docs directly from the API (Serverless + HTTP API).

## Local

1. Start the API:

```bash
npx serverless offline start
```

2. Open docs:
- `GET /api/docs` → `http://localhost:3000/api/docs`
- Spec file: `GET /api/docs/swagger.yaml` → `http://localhost:3000/api/docs/swagger.yaml`

## Files

- `swagger.yaml`: OpenAPI 3.0 spec (source of truth)
- `swagger.html`: Redoc UI page (served by API)
- `src/handlers/swaggerApi.js`: Lambda that serves docs

## Notes (production)

- In production, these endpoints will be behind your API Gateway domain.
- You can restrict access to docs using auth (recommended for internal portals).

