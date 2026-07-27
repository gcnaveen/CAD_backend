# Deployment provenance records (audit H-05)

After each `npm run deploy:*`, scripts write:

| File | Purpose |
|------|---------|
| `latest-<stage>.json` | Pointer to last successful deploy for that stage |
| `<stage>-<timestamp>-<sha12>.json` | Immutable archive of that deploy |
| `deploy-log.jsonl` | Append-only index (SHA, stage, tag, time) |

These JSON files are gitignored (may contain `serverless info` excerpts). Retain them in CI artifacts or an ops bucket for warranty / rollback.

Compare live `GET /api/version` → `gitSha` with `latest-<stage>.json` → `gitSha` and the release git tag.
