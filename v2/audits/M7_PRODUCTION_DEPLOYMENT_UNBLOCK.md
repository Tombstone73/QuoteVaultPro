# M7 production deployment unblock

**Status:** deployable source contract; not live-validated.
**Scope:** V2 `dev` only. No production, provider, Railway, Vercel, or database action was performed.

## Deployment contract

The reconstruction-only backend allowlist has been replaced with an exact, fail-closed pair allowlist:

| Target | Railway project | Railway environment | V2 API origin |
| --- | --- | --- | --- |
| DEV | `PrintersHero-DEV` | `Development` | `https://api-dev.printershero.com` |
| PROD | `PrintersHero-PRODUCTION` | `production` | `https://api.printershero.com` |

`NODE_ENV=production` remains required for a Railway deployment. Missing, unknown, or crossed project/environment pairs are rejected before the database pool is opened. `DATABASE_URL` remains the canonical deployment connection input and is syntax-validated without logging it.

V2 UI routing no longer embeds the DEV API domain. The Vercel route destinations expand the non-secret `V2_UI_API_ORIGIN` route variable at request time. The build also requires an exact, matching `V2_UI_DEPLOYMENT_TARGET`. Required values are:

| Vercel target | `V2_UI_DEPLOYMENT_TARGET` | `V2_UI_API_ORIGIN` |
| --- | --- | --- |
| DEV | `development` | `https://api-dev.printershero.com` |
| PROD | `production` | `https://api.printershero.com` |

That pair is intentionally explicit: a production target with the DEV origin (and the inverse) fails the UI build. It covers V2 API traffic and the QuickBooks and Google OAuth callback proxies. The root V1 `vercel.json` is untouched.

## Existing variables and first start

Existing Railway/Vercel production values remain the authority: `DATABASE_URL`, Supabase, Stripe, Google/Gmail, QuickBooks, session, public-origin, and encryption configuration are not recreated for V2. The new non-secret Vercel routing pair above and `V2_MUTATION_WORKERS_ENABLED` are the only source-required deployment controls identified here.

V2 deployment-owned QuickBooks billing, invoice-email, and proof-email loops previously started with the HTTP server. They now default to disabled. Set `V2_MUTATION_WORKERS_ENABLED=true` only after the controlled V2 readiness/smoke check; absent, `false`, and malformed values all keep them disabled. This is a narrow startup gate, not a worker-architecture change.

QuickBooks production OAuth/login remains a deliberate manual post-cutover action. Existing Stripe, Gmail, Supabase, and database credentials are not presumed to need replacement solely because V2 replaces V1. The previously recorded provider endpoint/authorization checks remain live-validation work, not a credential-recreation requirement.

## Remaining real blockers

This change removes the source-level DEV-only backend and hardcoded-DEV frontend-routing blockers. It does not authorize deployment or cutover. Before a production release, validate the production Vercel route variables/domains and existing provider state, complete the established write-free/reconciliation gates, start V2 with mutation workers disabled, smoke test, then explicitly release workers. The existing Railway predeploy migration policy is unchanged by this surgical milestone and remains subject to the approved cutover runbook.
