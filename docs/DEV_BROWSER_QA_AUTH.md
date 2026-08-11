# DEV browser QA authentication

`npm run test:e2e:dev` signs into the deployed DEV application using the normal
password login route. It does not use a shared browser tab, a token, an auth
bypass, or an application-only QA route.

## One-time DEV account provisioning

Use the guarded Railway DEV command below to create the account with the same
normal `users`, password `auth_identities`, and `user_organizations` records
used by the application. It is idempotent for the dedicated QA email and never
prints credentials or connection details:

1. Set the named QA configuration in the Railway DEV environment only, including
   `PRINTERSHERO_DEV_QA_PROVISION_ENABLED=true` for the one-time run.
2. Run `npm run qa:provision-dev-user` in the Railway DEV service shell.
3. Remove `PRINTERSHERO_DEV_QA_PROVISION_ENABLED` after the command succeeds.

The command requires `NODE_ENV=production`, `APP_ENV=development`, the reviewed
`https://dev.printershero.com` public origin, and the known DEV-cloud database.
It rejects local, unknown, and production environments. The account is a normal
DEV org-admin identity with exactly one organization membership; it is not a
service account and has no platform-admin privileges.

To retire the account, remove its DEV organization membership using the same
normal user-management surface. Do not use this fixture against another target.

## Local or CI configuration

Copy `.env.playwright.example` to the ignored `.env.playwright` file, or set the
same values in the CI secret store. Use these names only:

```
PLAYWRIGHT_BASE_URL
PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN
PRINTERSHERO_DEV_QA_EMAIL
PRINTERSHERO_DEV_QA_PASSWORD
PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID
PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG
```

For the standard deployment, both origin settings are `https://dev.printershero.com`.
If DEV moves to another frontend origin, change both settings to that reviewed DEV
origin. The fixture rejects `printershero.com`, `www.printershero.com`, and
`api.printershero.com`, then requires `/api/health` to report `development` and
the authenticated runtime API to classify itself as `deployed-dev`.

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
npm run test:e2e:dev
```

The setup plus `login.spec.ts` exercise two independent fresh browser logins.
`dev-qa-smoke.spec.ts` then checks that the authenticated user can reach Products,
Orders, and open the AI Operator. QA mutations must use disposable DEV records
with a `QA` or `Test` prefix and should clean up reversible data when practical.
