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

**V2 DEV DATABASE SOURCE NOT SAFELY VERIFIED**

Provide authenticated access to the database provider (or an already-provisioned, independently identified V2 DEV database connection stored through the intended secret channel) and metadata demonstrating that the intended clone source is V1 DEV rather than production. The provider context must also permit creating a separate V2 DEV branch/database. After that is available, configure its V2-only secret in the dedicated service, apply the checked-in migrations, provision the existing canonical Staff identity and V2 permission assignment, and continue the approved parallel deployment.

No DEV live validation has been claimed.
