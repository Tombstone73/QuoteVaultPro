# M5 DEV live-validation record

**Decision:** `DEV LIVE VALIDATION NOT READY`

**Validation date:** 2026-08-17  
**Authoritative source at preflight:** `v2/reconstruction` / `24dd26af` (`feat(v2): add standalone staff authentication`)

## Scope and safeguards

This is a pre-deployment record, not a claim of a live V2 deployment. The V1 DEV endpoints (`dev.printershero.com` and `api-dev.printershero.com`) were not changed. The known local-review-only changes in `v2/scripts/m175bBrowserHost.ts` and `v2/ui/src/App.tsx` were preserved, unstaged, and excluded from this record.

## Git and source preflight

- `origin/dev` and `origin/main` resolved to `80c453fc` during preflight.
- `origin/dev` is an ancestor of `v2/reconstruction`; the source was 60 commits ahead and could be promoted by a normal fast-forward once infrastructure is ready.
- No merge was active. No source, DEV, or MAIN push was performed during this blocked validation.
- The source has not yet been published to `origin/v2/reconstruction`; it must be preserved remotely before the eventual DEV promotion.

## Provider and DNS preflight

- The authenticated Railway context is the `PrintersHero-DEV` project, Development environment. It currently has one online legacy service, `Printershero-DEV`, with the V1 DEV API domain. No V2 Railway service was created or changed.
- The authenticated Vercel team is `dale-hensleys-projects`. Its existing `printershero-development` project serves the V1 DEV frontend. No V2 Vercel project was created or changed.
- `v2-dev.printershero.com` and `api-v2-dev.printershero.com` did not resolve at preflight. No DNS-provider credentials or exact provider-generated targets were available, so no DNS record was changed.

### 2026-08-17 recheck: existing V2 Railway environment authorization

The subsequently authorized deployment path was rechecked against the authenticated Railway account without displaying secret values. The intended `PrintersHero-DEV` / `Development` context still contains exactly one service: the legacy `Printershero-DEV` service attached to `api-dev.printershero.com`. Its 46 configured variable names include legacy `DATABASE_URL`, but do **not** include `V2_DATABASE_URL`, `V2_SESSION_SECRET`, or `V2_PUBLIC_WEB_ORIGIN`; no optional V2 service/release/storage variable was present either.

The authenticated Railway account contains only `PrintersHero-PRODUCTION`, `PrintersHero-DEV`, and `prepresshero`; the current intended DEV project has no dedicated V2 service. The authenticated Vercel team likewise has no dedicated V2 project, and neither V2 DEV hostname resolves. No secrets, service configuration, database, DNS record, Vercel project, or Git deployment branch was changed during this recheck.

## Database provenance and migration status

The deployment contract requires a distinct `V2_DATABASE_URL` and explicitly rejects a legacy `DATABASE_URL` fallback. The local environment contained neither a V2 database URL nor a Neon/provider credential. The inspected Railway DEV project contains no managed database resource; its V1 service database is externally managed. Safe metadata sufficient to prove that external source is specifically V1 DEV, and provider access necessary to create an isolated branch/clone, were not available.

Therefore no database was created, cloned, linked, or migrated. No V1 or production database was queried or modified.

The repository-only migration preflight passed:

- journal: 204 immutable V2 entries, ending `0208_v2_payment_history_capability`;
- migration-history integrity: passed.

## Completed local validation

The exact reconstruction source previously passed the V2 static checks, server and UI production builds, UI tests, focused standalone-auth/deployment tests, import-boundary checks, and M5 commercial, operational, and financial parity checks. These are local evidence only; they do not replace database, deployment, authentication, browser, routing, workflow, visual, appearance, or responsive live validation.

## Unperformed live validation

The following remain deliberately unperformed: isolated database provisioning and identity/permission bootstrap; V2 migrations; V2 Railway and Vercel service/project setup; V2 DNS/TLS; DEV promotion and deployment; real Staff login/session/CSRF/logout; SPA/API rewrite and deep-link checks; tenant data sanity; commercial/operational/finance workflows; and authenticated visual, appearance, and responsive checks.

## Exact blocker and next required input

**REQUIRED EXISTING RAILWAY V2 ENVIRONMENT VARIABLES NOT FOUND**

Before the approved V2 deployment can continue, make the already-provisioned V2 environment/service identifiable in the authenticated `PrintersHero-DEV` project, or provide its exact Railway project/environment/service context. It must contain V2-only `V2_DATABASE_URL`, `V2_SESSION_SECRET`, and `V2_PUBLIC_WEB_ORIGIN`. No legacy `DATABASE_URL` will be substituted, and no V1 or production resource will be inspected or changed.

No DEV live validation has been claimed.
