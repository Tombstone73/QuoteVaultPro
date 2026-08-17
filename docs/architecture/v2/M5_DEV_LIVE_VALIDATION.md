# M5 DEV live-validation record

**Current decision:** `DEV CUTOVER PLUMBING READY`

**Validation date:** 2026-08-17  
**Authoritative source before this correction:** `v2/reconstruction` /
`c470bb85`

## Corrected architecture

The former parallel V2 DEV assumption was superseded by the owner-approved
cutover model. DEV will replace V1 in place: `dev.printershero.com` becomes the
V2 UI and `api-dev.printershero.com` becomes the V2 backend. The existing DEV
database, canonical Staff identity records, session secret, and web-origin
configuration are reused. MAIN/production remains V1 and untouched.

No parallel V2 domains, database, Railway service, or Vercel project are
required. The former `v2-dev.printershero.com` and
`api-v2-dev.printershero.com` discovery findings are therefore not deployment
blockers and are retained only as historical pre-correction evidence.

## Verified existing DEV contract

The authenticated Railway context is `PrintersHero-DEV` / `Development` /
`Printershero-DEV`. Names-only inspection verified existing canonical variables
including `DATABASE_URL`, `SESSION_SECRET`, `APP_PUBLIC_WEB_ORIGIN`, Railway
environment metadata, and the current storage/runtime configuration. No secret
value was displayed or changed.

The V2 cutover entrypoint now accepts `DATABASE_URL` only when the explicit
Railway DEV project/environment markers and `NODE_ENV=production` are present.
It rejects a production or otherwise unrecognised target before a database
connection is opened. Standalone V2 auth now uses the existing `SESSION_SECRET`
and exact `APP_PUBLIC_WEB_ORIGIN`; it keeps the separate `v2.sid` session
cookie and canonical identity/permission checks.

## Planned remote cutover (not performed)

- Fast-forward `dev` from the exact `v2/reconstruction` source.
- Switch `Printershero-DEV` to the V2 server build/start commands.
- Switch `printershero-development` to Vercel root directory `v2/ui` and its
  V2 project-scoped configuration.
- Apply the immutable, additive V2 migration stream to the existing DEV
  database and verify the V2 ledger.
- Validate real Staff authentication, session/CSRF, V2 API rewrite, SPA routes,
  representative workflows, visual appearance, and responsive behavior.

No remote database migration, provider configuration change, DEV promotion,
deployment, or live browser validation has been performed by this correction.

## Historical migration status

Repository migration preflight previously passed: the immutable V2 journal has
204 entries ending `0208_v2_payment_history_capability`. The remote DEV
migration status has not been queried or changed in this repository-only task.

## Local cutover-plumbing validation

The following repository-only checks passed for this correction:

- focused deployment, runtime-configuration, and standalone-auth/session tests;
- V2 server and UI TypeScript checks and production builds;
- V2 UI tests and import-boundary validation;
- migration journal and immutable-history integrity checks;
- M5 commercial, operational, and financial parity suites.

The focused deployment evidence proves canonical `DATABASE_URL` acceptance only
for the exact Railway DEV project/environment, rejection of production and
unrecognised deployment contexts, exact DEV browser-origin validation, V2 API
rewrite precedence, and exclusion of test-only authentication. These local
results do not claim a remote migration, DEV deployment, or live validation.

## Next action

Promote the exact V2 source to DEV, switch the existing DEV Railway/Vercel
deployments to the V2 build targets, apply V2 migrations to the existing DEV
database, and perform live DEV validation. Do not begin M6 before that work is
complete.
