# V2 DEV cutover deployment wiring

## Approved topology

DEV is the V1-to-V2 proving ground. At the approved cutover, the existing DEV
applications are replaced in place:

- frontend: `https://dev.printershero.com` serves the V2 UI;
- backend: `https://api-dev.printershero.com` serves the V2 backend;
- database: the existing canonical DEV `DATABASE_URL` receives the additive V2
  migration stream and becomes the V2 DEV runtime database.

This is not a parallel deployment. Do not create `v2-dev.printershero.com`,
`api-v2-dev.printershero.com`, a second DEV service/project, or a duplicate DEV
database merely for V2. MAIN and production remain V1 and unchanged.

## Existing DEV environment contract

The authenticated `PrintersHero-DEV` / `Development` / `Printershero-DEV`
environment supplies the canonical cutover configuration:

- `DATABASE_URL` for PostgreSQL;
- `SESSION_SECRET` for server sessions;
- `APP_PUBLIC_WEB_ORIGIN` for the exact browser origin;
- `PORT` and Railway deployment metadata;
- existing object-storage/runtime variables, including `SUPABASE_*`,
  `PRIVATE_OBJECT_DIR`, and object public-base configuration where the current
  application uses them.

The V2 deployment entrypoint intentionally consumes `DATABASE_URL`,
`SESSION_SECRET`, and `APP_PUBLIC_WEB_ORIGIN`; it does not require duplicate
`V2_*` copies. V2 currently persists artwork object references but does not
configure a separate upload provider at startup.

The deployment guard requires all of the following before opening a database
connection: `NODE_ENV=production`, `RAILWAY_PROJECT_NAME=PrintersHero-DEV`,
and `RAILWAY_ENVIRONMENT_NAME=Development`. It then validates the canonical
`DATABASE_URL` as PostgreSQL. This permits the approved DEV replacement while
failing closed for MAIN/production or an unrecognised Railway environment.

## Database and additive migrations

The existing DEV database is the intended V2 database after cutover. Its core
data (`users`, `auth_identities`, `organizations`, `user_organizations`, and
business records) is preserved. V2 migrations are additive and immutable; they
coexist with the existing core schema and use the V2 ledger
`public.__drizzle_migrations_v2`.

Each DEV Railway deployment runs `npm run v2:migrations:apply` as its
repository-controlled pre-deploy command. The command runs after the image
build and before the new application container starts. It uses the existing
V2 migration runner, which validates the exact DEV Railway context, uses the
V2 ledger, applies only pending migrations under its advisory lock, and exits
non-zero on a migration or release-verification failure. Railway then leaves
the prior deployment in place instead of starting new code against an old
schema.

`npm run db:migrations:v2:preflight` and `npm run v2:migrations:status` remain
read-only release-verification commands. `npm run v2:migrations:apply` is the
deployment lifecycle command; do not use it as an ad hoc substitute for a
normal DEV deployment.

The current checked-in journal ends at `0222_v2_product_version_routing_authoring`.
The migration guard validates the exact DEV Railway context first. No reset,
clone, recreation, or production migration is authorised.

## Standalone Staff authentication and sessions

V2 verifies the existing canonical `users` and password `auth_identities`
records with `bcryptjs`, then resolves active organization membership and V2
permission-set authority afresh. It creates no duplicate Staff identity or
password hash. A usable Staff account remains an `INTERNAL_USER`, must not
require an initial password change, and must resolve to an active organization
with active V2 permission-set authority.

V2 uses the canonical `SESSION_SECRET` but keeps its `v2.sid` cookie namespace.
The cookie is host-only, `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
`APP_PUBLIC_WEB_ORIGIN` must be the exact HTTPS DEV origin
`https://dev.printershero.com`; login, organization selection, and logout
reject a supplied different browser origin. The Vercel `/v2/*` rewrite keeps
browser requests same-origin and does not broaden CORS. The deployed entrypoint
never reads `V2_M175B_BROWSER_TEST`.

## Existing Railway DEV service

At cutover, update the existing `Printershero-DEV` service only after the DEV
branch promotion to use:

- build: `npm run v2:server:build`;
- start: `npm run v2:server:start`;
- entrypoint: `v2/src/deployment/server.ts` / `createV2HttpApp`;
- checks: `GET /health`, `GET /version`, and `GET /ready`.

The server uses Railway `PORT`, starts no migrations itself, creates the
canonical PostgreSQL pool only after the DEV guard passes, and shuts its HTTP
server and pool down safely. Migrations run once in Railway's pre-deploy phase,
not in each application instance.

## Existing Vercel DEV project

At cutover, update the existing `printershero-development` project (currently
rooted at `.`) to use root directory `v2/ui`, build command
`npm run build:vercel`, and output `dist`. Its project-scoped configuration is
`v2/ui/vercel.json`. That configuration sends `/v2/*` to
`https://api-dev.printershero.com/v2/*` before the SPA fallback, so an API route
can never become V2 HTML. The root `vercel.json` remains the V1/MAIN
configuration and is not changed by this cutover plumbing.

## Cutover sequence and boundaries

1. Validate the authoritative `v2/reconstruction` source.
2. Fast-forward `dev` from that exact source; never force, squash, or
   cherry-pick it.
3. Change the existing DEV Railway and Vercel projects to the build targets
   above.
4. Apply and verify the additive V2 migrations against the existing DEV
   database.
5. Validate real Staff login, session/CSRF, API rewrite, SPA deep links, and
   representative DEV workflows.

No remote configuration, migration, promotion, or live validation is performed
by this repository-only correction.
