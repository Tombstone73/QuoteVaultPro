# DEV browser QA authentication

`npm run qa:dev-browser` signs into the deployed DEV application using the normal
password login route. It does not use a shared browser tab, a token, an auth
bypass, or an application-only QA route.

## One-time DEV account provisioning

Use the guarded Railway DEV commands below to create the account with the same
normal `users`, password `auth_identities`, and `user_organizations` records
used by the application. It is idempotent for the dedicated QA email and never
prints credentials or connection details:

1. In the Railway dashboard, select the intended DEV project, environment, API
   service, and PostgreSQL service. Review the service's `DATABASE_URL` reference
   and DEV frontend origin. Do not copy or print the connection URL.
2. Run `npm run qa:inspect-dev-target` in that Railway DEV service context. This
   read-only command verifies the connected database user/name and reports only
   an opaque database identity, Railway environment ID, active org
   IDs/slugs, and whether the configured QA email already exists. Compare these
   facts with the reviewed Railway DEV services before proceeding.
3. Set `PRINTERSHERO_DEV_QA_APPROVED_RAILWAY_ENVIRONMENT_ID` to the reviewed DEV
   environment ID and `PRINTERSHERO_DEV_QA_APPROVED_DATABASE_IDENTITY` to the
   inspected `sha256:...` database identity. Set the dedicated QA email, a new
   strong password of at least 16 characters, expected org ID/slug, and approved origin in the DEV service
   secrets. Set `PRINTERSHERO_DEV_QA_PROVISION_ENABLED=true` only for the run.
4. Run `npm run qa:provision-dev-user` in the Railway DEV service context.
   Existing email collisions without this command's creation audit record fail
   closed; inspect those manually rather than resetting an unrelated account.
5. Remove `PRINTERSHERO_DEV_QA_PROVISION_ENABLED` after the command succeeds.

The command requires `NODE_ENV=production`, `APP_ENV=development`, the Railway
DEV environment name and exact approved ID, the reviewed
`https://dev.printershero.com` public origin, and the exact approved PostgreSQL
connection identity. It verifies the actual connected database user/name before
writing and rejects local, mismatched, and production configurations. The account is a normal
DEV org-admin identity with exactly one organization membership; it is not a
service account and has no platform-admin privileges.

The database identity is a SHA-256 digest of the connection host, effective port,
username, and database name. It omits the password and changes if any of those
connection components change. Reinspect and explicitly reapprove after a DEV
database move. The general runtime classifier retains its existing behavior;
the provisioning command uses this narrower positive identity check.

To retire the account, remove its DEV organization membership using the same
normal user-management surface. Do not use this fixture against another target.

## Local or CI configuration

Copy `.env.playwright.example` to the ignored `.env.playwright` file, or set the
same values in the local/CI secret store. The Playwright runner is outside
Railway, so it needs its own secure copy of the QA login values. It always
defaults to cloud DEV and never starts a local application. Use these names only:

```
PLAYWRIGHT_BASE_URL
PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN
PRINTERSHERO_DEV_QA_EMAIL
PRINTERSHERO_DEV_QA_PASSWORD
PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID
PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG
```

For the standard deployment, both origin settings are `https://dev.printershero.com`.
The fixture accepts only this reviewed DEV origin. It rejects `printershero.com`,
`www.printershero.com`, and `api.printershero.com`, then requires `/api/health` to return the approved DEV
public origin and the authenticated runtime API to classify itself as
`deployed-dev`. Railway DEV may correctly run with `NODE_ENV=production`.

## Session behavior and safe diagnostics

The setup project always removes `e2e/.auth/user.json` before a new normal login.
It writes a new state file only after verifying the QA email, the sole expected
organization, and the DEV runtime. The file is ignored by Git. A closed browser,
logout, expired cookie, redeploy, or server restart therefore results in a new
normal login on the next run rather than a dependence on a stale state file.

Failure output reports only target origin, health status, login-page reachability,
whether required credential variables were present, submit status, login HTTP
category, and authenticated-app reachability. It never logs passwords, cookies,
tokens, or credential values.

## Running the DEV smoke suite

```
npm run qa:dev-browser
```

The setup plus `login.spec.ts` exercise two independent fresh browser logins.
`dev-qa-smoke.spec.ts` then checks that the authenticated user can reach Products,
Orders, and open the AI Operator. QA mutations must use disposable DEV records
with a `QA` or `Test` prefix and should clean up reversible data when practical.

## Reusing the authenticated assistant Quote QA session

In the DEV checkout, run `npx playwright test e2e/dev-qa-quote-capability.spec.ts --reporter=line`.
The Playwright setup project performs a fresh normal password login from the ignored
`.env.playwright` fixture, confirms the configured QA identity has exactly one
admin membership in the expected DEV organization, verifies the deployed DEV
runtime, and writes the ignored `e2e/.auth/user.json` state for that run. The
Quote check verifies that the authenticated assistant has tools, diagnostics,
and the `quotes.create_draft` grant. This procedure does not require access to
someone else's browser tab. Never print the fixture values or commit the state
file.

Run `npx playwright test --project=setup e2e/auth.setup.ts --reporter=line` to
refresh the supported QA state independently. The login's own redirect may
still be completing after the session and organization checks, so callers
should wait for the authenticated page rather than start a competing navigation
to `/dashboard`. If a setting is missing or the login expires, refresh the
dedicated QA secret in the supported local/CI secret store and rerun setup.
Reprovision the account only after the guarded DEV identity preflight above
shows that it is absent. The browser tests use disposable `QA` or `Test`
records for mutation; the capability check performs reads only.
