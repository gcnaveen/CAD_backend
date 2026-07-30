# SECURITY: MongoDB Atlas credentials exposed in public GitHub docs

## Status

| Item | Status |
|------|--------|
| Working-tree docs scrubbed | Done (`LAMBDA_NETWORK_FIX.md`, `LAMBDA_VPC_FIX.md`, `MONGODB_ATLAS_SETUP.md`) |
| Git history rewrite | Done via `git filter-repo` (see below) |
| Force-push cleaned history to GitHub | Required after rewrite (rewrites `main`) |
| Rotate Atlas passwords | **You must do this in Atlas UI now** — agent cannot access Atlas |

Confirmed: the live `.env` `MONGODB_URI` password for user `cad_db_user` **matched** the password that was committed to public docs. Treat it as fully compromised.

## Exposed values (do not reuse)

1. **Real DB user (must rotate):** username `cad_db_user` on cluster host `cadstaging.gntbdiw.mongodb.net` (password was published in `LAMBDA_NETWORK_FIX.md` / `LAMBDA_VPC_FIX.md`).
2. **Example string (scrubbed; rotate/delete if this user was ever created):** `newuser` / example password in `MONGODB_ATLAS_SETUP.md`. If that Atlas user does not exist, skip; if it does, delete or rotate it.

## Rotate Atlas credentials (do this immediately)

### A. `cad_db_user` (production / staging in use)

1. Open [MongoDB Atlas](https://cloud.mongodb.com/) → **Database Access**.
2. Edit user **`cad_db_user`** → **Edit Password** → generate a long random password (20+ chars). Save it in a password manager only.
3. URL-encode special characters (`@` → `%40`, etc.) when building `MONGODB_URI`.
4. Update **local** `.env`:
   - `MONGODB_URI`
   - `MONGODB_URI_STANDARD` (same user/password)
5. Update **every Lambda** env var that sets `MONGODB_URI` / `MONGODB_URI_STANDARD` (AWS Console or redeploy with new env).
6. Smoke-test: local `GET /test` (or health) + one authenticated API call against the deployed stage.
7. Optionally create a new user (e.g. `cad_db_user_v2`), switch apps to it, then **delete** the old compromised user.

### B. `newuser` (only if it exists in Atlas)

1. Database Access → if `newuser` exists → **Delete** or rotate password.
2. Confirm no app/env still references it.

## After history rewrite + force-push

1. Anyone with a clone must re-clone or hard-reset to the new `origin/main` (old SHAs are obsolete).
2. In GitHub: **Settings → Security → Secret scanning** / contact GitHub support if the secret still appears in cached forks.
3. Make the repo **private** if it must stay non-public (recommended until audit closes).
4. Add a pre-commit / CI secret scan (e.g. gitleaks) so connection strings never land in docs again.

## Frontend

No frontend code changes. App continues to use the API; only **backend `.env` / Lambda `MONGODB_URI`** must change after Atlas rotation.

## Verify scrub on GitHub (after force-push)

```bash
# Must return empty
git fetch origin
git grep -n '<URL_ENCODED_PASSWORD>\|cad_db_user:caduser\|newpassword123' origin/main -- \
  LAMBDA_NETWORK_FIX.md LAMBDA_VPC_FIX.md MONGODB_ATLAS_SETUP.md

# Raw blob check (replace OWNER/REPO if needed)
curl -sL "https://raw.githubusercontent.com/gcnaveen/CAD_backend/main/LAMBDA_NETWORK_FIX.md" | grep -E '<URL_ENCODED_PASSWORD>|cad_db_user:' || echo "OK: no leak in raw file"
```
