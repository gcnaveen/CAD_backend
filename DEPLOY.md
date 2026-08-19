# Deploy

```bash
# Required env: JWT_SECRET, S3_BUCKET, MONGODB_URI (or MONGODB_URI_STANDARD), --stage
npm run deploy:dev
npm run deploy:prod
```

Wrapper: `scripts/deploy-with-identity.js`. Stage must be `dev` | `staging` | `prod`.
TLS verification is always required.

## TLS / certificate errors

Do **not** set `NODE_TLS_REJECT_UNAUTHORIZED=0` and do not pass `--insecure`.
If deploy fails with certificate errors, fix the local CA/proxy trust chain
(corporate proxy: install the intercepting CA in the system trust store).

## Secrets

Never commit `.env`. Production `JWT_SECRET` rotation: `docs/SECURITY_H01_SECRET_ROTATION.md`.
