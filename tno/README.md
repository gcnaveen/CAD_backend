# TNO data: Districts, Taluks, Hoblis

This folder holds JSON exports (districts, taluks, hoblis, villages) and scripts to seed the CAD backend database with correct **District → Taluka → Hobli → Village** references.

## Files

| File | Description |
|------|-------------|
| `tnov1.districts.json` | District records (`_id`, `district_id`, `name`, `k_name`, `is_active`, `is_archived`) |
| `tnov1.taluks.json` | Taluk records (`_id`, `taluk_id`, `name`, `district` as ObjectId ref, …) |
| `tnov1.hoblis.json` | Hobli records (`_id`, `hobli_id`, `name`, `district`, `taluk` as ObjectId refs, …) |
| `tnov1.villages.json` | Village records (`_id`, `village_id`, `village_code`, `name`, `district`, `taluk`, `hobli` as ObjectId refs, …) |

## Correct mapping

- **Districts** are inserted with `code` = a short **name-based** code (example: `BENGALURU URBAN` → `BU`, `MYSORE` → `MYSR`). If a code collides, a numeric suffix is used (example: `BU01`), still kept short.
- **Taluks** must point to a district via `districtId` (ObjectId). The JSON has `district: { $oid: "..." }` from the source DB.
- **Hoblis** must point to district and taluk via `districtId` and `talukaId`. The JSON has `district` and `taluk` OIDs.
- **Villages** must point to district, taluk, and hobli via `districtId`, `talukaId`, `hobliId`.

If the **district** (and taluk) OIDs in `tnov1.taluks.json` / `tnov1.hoblis.json` are from a **different database** than the `_id` values in `tnov1.districts.json`, those refs won’t match. You then need an **OID mapping** so the seed script can resolve:

- district OID (as in taluks/hoblis) → `district_id` (1, 2, 3, …) used in `tnov1.districts.json`

## Steps to dump into your database

### 1. Same-DB case (district OIDs in taluks = `_id` in districts file)

If your three JSON files were exported from the **same** database so that `district` in taluks equals some district’s `_id` in the districts file:

```bash
# Optional: see what would be inserted
node tno/seed-districts-taluks-hoblis.js --dry-run

# Run seed (uses MONGODB_URI or MONGODB_URI_STANDARD from .env)
node tno/seed-districts-taluks-hoblis.js
```

### 2. Cross-DB case (district OIDs in taluks ≠ `_id` in districts file)

If taluks/hoblis reference district OIDs that **do not** appear as `_id` in `tnov1.districts.json`:

1. **Export districts from the DB that was used for taluks/hoblis**  
   That export must include `_id` and `district_id` for each document. Save it as:

   `tno/taluks-source-districts.json`

2. **Build the OID mapping:**

   ```bash
   node tno/build-oid-mapping.js
   ```

   This creates `tno/oid-mapping.json` with `districtOidToDistrictId` (district OID → numeric `district_id`). The seed script uses this to resolve district refs in taluks/hoblis to the districts you inserted (the numeric `district_id` is only used to find the right inserted district ObjectId; it is **not** used as the District `code`).

3. **Run the seed:**

   ```bash
   node tno/seed-districts-taluks-hoblis.js
   ```

## Requirements

- Node.js with project dependencies installed (`npm install`).
- `.env` in project root with `MONGODB_URI` or `MONGODB_URI_STANDARD` (and optionally `MONGODB_DISCOVER_PRIMARY` as in the rest of the app).

## Schema mapping summary

| TNO JSON field | App model (District / Taluka / Hobli / Village) |
|----------------|---------------------------------------|
| `district_id` | Used only for mapping/lookup; District `code` is name-based |
| `taluk_id` | Not used for `code` (Taluka `code` is name-based); Taluka `districtId` from resolved district |
| `hobli_id` | Not used for `code` (Hobli `code` is name-based); Hobli `districtId` / `talukaId` from resolved district/taluk |
| `village_id` / `village_code` | Not used for `code` (Village `code` is name-based); Village refs are resolved from district/taluk/hobli OIDs |
| `is_active` / `is_archived` | `status`: ACTIVE or INACTIVE |
| `name` / `k_name` | `name` |

`division` and `division_id` from the JSON are not used by the current District/Taluka/Hobli models.
