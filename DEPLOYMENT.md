# Deployment — Staging & Production

7okko ships as **three independent git repos** (backend, frontend, admin), each
with a `main` (production) and `staging` branch, auto-deployed by GitHub Actions.

| Repo | Staging worker/URL | Production worker/URL |
|---|---|---|
| `tokko-v2-backend` | `tokko-api-staging` → staging-api.7okko.com | `tokko-api` → api.7okko.com |
| `tokko-v2-frontend` | `tokko-v2-frontend-staging` → staging.7okko.com | `tokko-v2-frontend` → 7okko.com |
| `tokko-v2-admin` | `tokko-v2-admin-staging` → staging-admin.7okko.com | `tokko-v2-admin` → admin.7okko.com |

## Branch flow

```
feature/* ──┐
            ▼
         staging   ──CI──▶  staging workers (isolated D1 + R2)
            │
            ▼  (merge when verified)
         main       ──CI──▶  production workers
```

## How the pipelines work

Each repo has `.github/workflows/deploy.yml`:

- **Push to `staging`** → typecheck/tests → build → `wrangler deploy --env staging`
  - Backend also applies D1 migrations to `tokko-db-staging` first.
  - Frontend/admin build with `.env.staging` (API URL → staging-api.7okko.com).
- **Push to `main`** → same checks → `wrangler deploy` (production)
  - Backend applies migrations to `tokko-db` first.
  - Frontend/admin build with `.env.production`.

## One-time setup required

### 1. GitHub repo secrets (each of the 3 repos)
The workflows deploy with Cloudflare auth from GitHub secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with `Workers Scripts: Edit`, `Workers D1: Edit`, `Workers R2: Edit` permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (see dashboard home) |

Set at: repo → Settings → Secrets and variables → Actions.

### 2. Secrets on the staging workers (backends only)
The staging API worker needs the same secrets as production (values are
write-only — copy them from your production setup):

```bash
cd tokko-v2-backend
# set each against the staging worker:
npx wrangler secret put BETTER_AUTH_SECRET --env staging
npx wrangler secret put GOOGLE_CLIENT_ID    --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put RESEND_API_KEY      --env staging
npx wrangler secret put LLM_API_KEY         --env staging
npx wrangler secret put BITESHIP_API_KEY    --env staging
# optional: XENDIT_SECRET_KEY, XENDIT_WEBHOOK_TOKEN — see src/ for full list
```

### 3. Staging custom domains (Cloudflare dashboard)
Each staging worker needs its custom domain added in the dashboard
(Workers → your worker → Settings → Domains & Routes → Custom Domains):

- `tokko-api-staging` → `staging-api.7okko.com`
- `tokko-v2-frontend-staging` → `staging.7okko.com`
- `tokko-v2-admin-staging` → `staging-admin.7okko.com`

### 4. CORS on the API (already handled)
`src/index.ts` reads `FRONTEND_URL` from vars — the staging env sets it to
`https://staging.7okko.com`, so staging frontend ↔ staging API calls work.

## Staging cloud resources (already created)

| Resource | Name | ID |
|---|---|---|
| D1 database | `tokko-db-staging` | `4c6cf08d-b472-48e3-8487-411c5b8f4f62` |
| R2 bucket | `tokko-images-staging` | — |

Migrations have already been applied to `tokko-db-staging` (all 17), so the
schema matches production.

## Promoting a release

1. Work on a feature branch, PR → `staging`. Verify on staging URLs.
2. PR `staging` → `main`. CI runs the same checks, then deploys production.
3. Production DB migrations run automatically on the `main` push — review
   migration SQL before merging anything that alters `tokko-db`.

## Manual commands (without CI)

```bash
# backend — staging
npx wrangler d1 migrations apply tokko-db-staging --remote --env staging
npx wrangler deploy --env staging

# backend — production
npx wrangler d1 migrations apply tokko-db --remote
npx wrangler deploy

# frontend/admin — staging (build with staging env)
cp .env.staging .env.production && npx opennextjs-cloudflare build
npx wrangler deploy --env staging

# frontend/admin — production
npx opennextjs-cloudflare build && npx wrangler deploy
```

## Notes

- `tokko-v2-video` is a **local-only** content-production repo (no remote, not
  in the deploy pipeline).
- Staging D1/R2 are fully isolated from production — seeding or experimenting
  on staging never touches `tokko-db` / `tokko-images`.
