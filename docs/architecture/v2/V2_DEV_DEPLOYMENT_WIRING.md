# V2 DEV deployment wiring

## Scope and separation

This document describes the independent V2 DEV topology only. It does not change, replace, or route through the existing V1 DEV deployment:

- V1 UI remains `https://dev.printershero.com`.
- V1 API remains `https://api-dev.printershero.com`.
- V2 UI is expected at `https://v2-dev.printershero.com`.
- V2 API is expected at `https://api-v2-dev.printershero.com`.

The V2 names are the approved conceptual target names for this work. DNS, Vercel project domains, Railway service/domain attachment, and certificates are external infrastructure configuration and must be verified before promotion. No repository configuration authorizes changing V1 domains.

## V2 UI (Vercel)

Create a separate Vercel project with **Root Directory** `v2/ui`. Its project-scoped configuration is `v2/ui/vercel.json`; do not use the root `vercel.json`, which remains V1-only.

The V2 project installs `v2/ui/package.json`, runs `npm run build:vercel`, and publishes `dist`. Its rewrite list sends `/v2/...` to the expected V2 API **before** the SPA fallback. Confirm the Vercel project has the final `v2-dev.printershero.com` domain and that the external API hostname matches the dedicated Railway domain before deployment.

## V2 API (Railway)

Create a new service in the intended DEV project; do not attach this source to the legacy `Printershero-DEV` service or `api-dev.printershero.com`.

- Build command: `npm run v2:server:build`
- Start command: `npm run v2:server:start`
- Liveness: `GET /health`
- Version: `GET /version`
- Readiness: `GET /ready`

The entrypoint is `v2/src/deployment/server.ts`. It uses Railway `PORT`, requires a valid `V2_DATABASE_URL`, creates a V2-only PostgreSQL pool, composes the canonical `createV2HttpApp` with all V2 module runtimes, and releases its HTTP and database resources on shutdown. It never starts migrations on boot.

## Database and migrations

Provision a separate V2 DEV database. Set only its credentials in `V2_DATABASE_URL`; never set it to the legacy `DATABASE_URL` value. Startup rejects missing, malformed, or detectably-equal legacy/V2 URLs. No credentials belong in this repository.

Run migration work as a deliberate release operation, from the exact source commit being promoted:

1. `npm run db:migrations:v2:preflight`
2. `npm run v2:migrations:status`
3. `npm run v2:migrations:apply`
4. `npm run v2:migrations:status`

The current checked-in V2 journal ends at `0208_v2_payment_history_capability`. The V2 commands validate `V2_DATABASE_URL` first, then pass that same value only to the established migration/status runner for the lifetime of the command. They do not use a legacy URL as a fallback and do not run during application startup. Check the resulting `public.__drizzle_migrations_v2` ledger and the runner's release-verification output before considering the schema ready.

## Authentication: deployment blocker

**V2 DEV AUTH DEPLOYMENT BLOCKER:** no dedicated standalone V2 authentication/session implementation is present. The legacy Passport/session host depends on the legacy application and database and cannot safely be reused by a separate V2 service or cross-domain browser session.

Until a real V2 auth/session adapter is implemented and configured, the standalone V2 service intentionally returns `503 AUTH_CONFIGURATION_REQUIRED` for every `/v2/...` business request. It does not use the browser-fixture auto-login and does not manufacture a staff principal. `/health` and `/version` remain usable for infrastructure checks; `/ready` remains unavailable while the auth blocker exists.

## Remaining external configuration

- Add V2-only Railway variables: `V2_DATABASE_URL`, optionally `V2_SERVICE_NAME` and `V2_RELEASE_VERSION`. Railway supplies `PORT`.
- Attach and validate the dedicated `api-v2-dev.printershero.com` domain and TLS certificate, then configure the Vercel V2 project with `v2-dev.printershero.com`.
- Configure a dedicated V2 session/auth mechanism, secure cookie policy, allowed V2 UI origin, and CSRF/session rotation behavior before enabling application routes.
- Provision V2 storage credentials/bucket/prefix and least-privilege access before enabling artwork upload/adoption. The current V2 artwork flow works with persisted object references; it does not configure a standalone upload provider.
- Verify database backup, retention, network access, and the V2 migration ledger independently from V1.

No deployment, promotion, DNS update, variable update, migration, or live validation is performed by this code change.
