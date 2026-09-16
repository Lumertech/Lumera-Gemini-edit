# Cloud SQL Postgres — Lumera durability (Epic 0)

**Status:** code + Cloud Run wiring only. This agent did **not** create a billed
Cloud SQL instance. Confirm the decisions below with whoever holds GCP billing
(`ravee@lumer.me`) **before** anyone runs the `gcloud sql instances create`
commands.

Lumera is **not** a certified Meta Tech Provider, does not claim HIPAA-grade
controls, and is not “ABDM Compliant” by virtue of using Postgres.

Production app: Cloud Run service **`lumera-gemini-edit`** in **`asia-south1`**
behind Firebase Hosting `https://www.mylumera.in`.

## Why this exists

`server/db.ts` used `node:sqlite` (`DatabaseSync`) at `data/lumera.db`. The
Dockerfile `mkdir -p /app/data`. Cloud Run has **no volume**. Every new
revision, scale-to-zero wake, and extra instance either wipes PHI or fragments
it across independent SQLite files.

Dual-mode after this change:

| Environment | Backend |
|---|---|
| Tests / local `tsx` with `DATABASE_URL` **unset** | sqlite `data/lumera.db` (existing tests) |
| `NODE_ENV=production` boot (`npm start` / Cloud Run) | **Postgres required** — process **exits before listen** if `DATABASE_URL` is missing (same pattern as `JWT_SECRET`) |
| Cloud Run (`K_SERVICE` / `dist/server.cjs`) | sqlite fallback **forbidden** even if someone calls `initDatabase()` |

Do not merge this until Cloud SQL exists **and** `DATABASE_URL` is set on the
service, or `www.mylumera.in` will fail to boot.

## Decisions the founder must confirm (do not guess)

Region is already **`asia-south1`** (match Cloud Run). Everything else is a
spend / ops choice:

1. **Does a Cloud SQL instance already exist** in project `gen-lang-client-0108182367`?
2. **Instance name** (example placeholder only: `lumera-pg` — pick the real name).
3. **Database name** (code default in docs: `lumera`).
4. **Tier / machine type** (e.g. `db-f1-micro` vs `db-custom-1-3840` vs enterprise). **Do not pick this in an agent session.**
5. **HA vs single zone** (regional HA roughly doubles instance cost).
6. **Storage size + SSD vs HDD**, autopause / storage autosize.
7. **Backups** (automated backups — recommended on) and **PITR** (point-in-time recovery; extra storage cost; recommended for PHI).
8. **Private IP vs unix socket only** (Cloud Run Cloud SQL Auth Proxy unix socket is the path this repo implements; private IP / VPC connector is an alternative).
9. **Who holds billing**, and which Google account may run `gcloud sql instances create`.

Hostinger MCP and this agent’s GCP APIs **cannot** purchase Cloud SQL. Use the
commands below from a billed, authenticated founder laptop after the list above
is decided.

## Connection contract (unix socket)

Cloud Run `--add-cloudsql-instances=PROJECT:asia-south1:INSTANCE` mounts:

```
/cloudsql/PROJECT:asia-south1:INSTANCE
```

`DATABASE_URL` (Secret Manager — never git, never `cloudbuild.yaml --set-env-vars`):

```
postgres://USER:PASSWORD@/DBNAME?host=/cloudsql/PROJECT:asia-south1:INSTANCE
```

Equivalent pieces (composed by `src/db/url.ts` if `DATABASE_URL` is unset):

| Env | Meaning |
|---|---|
| `INSTANCE_CONNECTION_NAME` | `PROJECT:asia-south1:INSTANCE` (alias `CLOUD_SQL_CONNECTION_NAME`) |
| `SQL_USER` / `POSTGRES_USER` | database user |
| `SQL_PASSWORD` / `POSTGRES_PASSWORD` | database password |
| `SQL_DB_NAME` / `POSTGRES_DB` | database name (`lumera`) |

`cloudbuild.yaml` substitution `_CLOUDSQL_INSTANCE` defaults to `none`. After
the instance exists, set the trigger substitution to
`PROJECT:asia-south1:INSTANCE`. The deploy step then passes
`--add-cloudsql-instances`. It still uses `--update-env-vars` for
`NODE_ENV`/`APP_URL` only so `JWT_SECRET` / `DATABASE_URL` are not wiped.

## gcloud sketch (run only after the confirmations above)

Replace `INSTANCE`, `TIER`, `PROJECT`. These are **not** recommendations for
size — they are the flag shape.

```bash
export PROJECT=gen-lang-client-0108182367
export REGION=asia-south1
export INSTANCE=REPLACE_WITH_CONFIRMED_NAME
export DB_NAME=lumera
export SQL_USER=lumera
# TIER and HA flags: founder confirms. Do not copy a guessed --tier into prod.

# 1. Instance (CHOOSE --tier / HA / PITR after the decision list)
gcloud sql instances create "${INSTANCE}" \
  --project="${PROJECT}" \
  --database-version=POSTGRES_15 \
  --region="${REGION}" \
  --availability-type=ZONAL \
  --backup-start-time=18:00 \
  --retained-backups-count=7
  # Add --enable-bin-log equivalent for Postgres PITR only if confirmed:
  #   --enable-point-in-time-recovery
  # Add --tier=... only with an explicit confirmed value.

# 2. Database + user
gcloud sql databases create "${DB_NAME}" --instance="${INSTANCE}" --project="${PROJECT}"
gcloud sql users create "${SQL_USER}" --instance="${INSTANCE}" --project="${PROJECT}" --password='USE_SECRET_MANAGER'

# 3. Cloud Run attach + secrets (after image deploy)
export SERVICE=lumera-gemini-edit
gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --add-cloudsql-instances="${PROJECT}:${REGION}:${INSTANCE}" \
  --update-secrets=DATABASE_URL=DATABASE_URL:latest \
  --update-env-vars="INSTANCE_CONNECTION_NAME=${PROJECT}:${REGION}:${INSTANCE}"
```

Grant the Cloud Run runtime service account `roles/cloudsql.client`.

## Schema / migrations

- Canonical Postgres shape: `src/db/schema.ts` (Drizzle, 1:1 with sqlite migrate).
- Runtime still runs `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN`
  through the compatibility shim so empty databases bootstrap without a separate
  migrate job. SQLite idioms (`?`, `INSERT OR REPLACE`, `PRAGMA`) are translated
  in `server/sql-dialect.ts`.
- Generate SQL (no live instance required):

```bash
npx drizzle-kit generate --config src/db/drizzle.config.ts
```

- Apply (needs `DATABASE_URL`):

```bash
npx drizzle-kit migrate --config src/db/drizzle.config.ts
# or: psql "$DATABASE_URL" -f drizzle/0000_*.sql
```

Local Cloud SQL Auth Proxy (developer laptop):

```bash
cloud-sql-proxy PROJECT:asia-south1:INSTANCE --port=5432
export DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/lumera
```

## Shim vs full Drizzle rewrite

This epic ships a **thin `prepare().run/get/all()` shim** over `pg` (option a),
not a rewrite of 20+ `server/*.ts` call sites to `drizzle` (option b). See the
PR body for the tradeoff. Follow-up: replace the shim with async Drizzle once
PHI is on Cloud SQL.

## Honesty

Not a certified Meta Tech Provider. No HIPAA / Official Tech Provider /
Certified M1–M3 / “ABDM Compliant” claims. Questions: **ravee@lumer.me**.
