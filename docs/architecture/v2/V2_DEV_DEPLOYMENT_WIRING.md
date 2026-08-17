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

## Standalone Staff authentication and session

V1’s production login uses `email` plus a `bcryptjs` comparison against the canonical `auth_identities` row with `provider='password'`; that identity belongs to `users`. V2 reuses that exact credential owner and verifier behavior through `V2_DATABASE_URL` only. It does not read `DATABASE_URL`, create a password copy, create Staff accounts, or translate Admin/Owner flags into capabilities.

The isolated V2 DEV database must therefore be provisioned with the canonical core identity records (`users`, `auth_identities`, and active `user_organizations` rows) as well as the V2 permission-set tables and assignments. A Staff account must be an `INTERNAL_USER`, must not require an initial password change, must have a bcrypt password identity, and must resolve to at least one active organization with an active V2 Staff permission-set assignment. The canonical schema has no separate Staff-active column, so current eligibility is derived from those account and membership/permission facts. This is **V2 DEV IDENTITY DATA PROVISIONING REQUIRED**, not a V1-database runtime dependency.

`POST /v2/auth/login` accepts the canonical email/password pair and returns the safe session bootstrap envelope. Unknown, malformed, disabled/ineligible, and bad-credential attempts all return the same `INVALID_CREDENTIALS` response. The endpoint is rate limited in process (10 attempts per 15 minutes per source); configure Railway/edge rate limiting too, because an individual process limiter is not a distributed security control.

The standalone server stores only Staff subject identity and optional active organization in a V2 PostgreSQL-backed `v2.sid` session. The cookie is host-only, `HttpOnly`, `SameSite=Lax`, and has a seven-day maximum lifetime; it is `Secure` in production. The intended Vercel same-origin `/v2/*` rewrite keeps this browser-safe without CORS or wildcard origins. In production, `V2_PUBLIC_WEB_ORIGIN` is required and must be the exact HTTPS V2 UI origin; a supplied browser `Origin` must match it for login, organization selection, and logout.

`GET /v2/auth/session` restores a browser session. A user with one eligible organization is activated automatically; a user with multiple organizations must call `POST /v2/auth/active-organization` with the session CSRF token. The operation verifies the organization through the same current V2 permission-set issuance path and rotates the opaque CSRF/session-scope values. Session organization is enforced on workspace routes. `POST /v2/auth/logout`, also CSRF-protected, destroys the server session and clears `v2.sid`.

The normal V2 routes still reconstruct a Staff Principal at request time using fresh `user_organizations`, organization state, and V2 permission-set assignments via `PermissionSetPrincipalIssuer` and `AuthorityPolicy`. Membership removal, permission-set changes, and inactive organizations therefore deny subsequent route authorization without waiting for cookie expiry. Portal, Service, and delegated-AI principals are not issued by Staff login.

`V2_M175B_BROWSER_TEST=1` remains restricted to the browser fixture host. The production entrypoint never reads it and never exposes fixture identity.

## Remaining external configuration

- Add V2-only Railway variables: `V2_DATABASE_URL`, `V2_SESSION_SECRET` (32+ characters), `V2_PUBLIC_WEB_ORIGIN` (the exact `https://v2-dev.printershero.com` origin), and optionally `V2_SERVICE_NAME` and `V2_RELEASE_VERSION`. Railway supplies `PORT`.
- Attach and validate the dedicated `api-v2-dev.printershero.com` domain and TLS certificate, then configure the Vercel V2 project with `v2-dev.printershero.com`.
- Provision the V2 identity and membership/permission data described above before enabling Staff login. Do not copy it through an application-side dual-write path or point V2 at the legacy database.
- Provision V2 storage credentials/bucket/prefix and least-privilege access before enabling artwork upload/adoption. The current V2 artwork flow works with persisted object references; it does not configure a standalone upload provider.
- Verify database backup, retention, network access, and the V2 migration ledger independently from V1.

No deployment, promotion, DNS update, variable update, migration, or live validation is performed by this code change.
