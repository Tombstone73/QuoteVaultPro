# M5 DEV live-validation record

**Decision:** `DEV LIVE VALIDATION PASS - READY TO PROCEED`
**Validation date:** 2026-08-17  
**Authoritative source / deployed DEV commit:** `v2/reconstruction` and `dev` at
`85f9bca0b72e6d01035b35221e4f31c5a02c38bf`.

## Pre-cutover rollback state

- `origin/dev`: `80c453fc9b1fdb73be79b08fcb71eba01b2581ac` (V1)
- `origin/main`: `80c453fc9b1fdb73be79b08fcb71eba01b2581ac` (unchanged)
- approved V2 source: `be4e54d6a89df1a2957de8ad42f7706372c8d214`
- Railway target: existing `PrintersHero-DEV` / `Development` /
  `Printershero-DEV`, API domain `api-dev.printershero.com`; its legacy build
  and start commands were automatic/Railpack before the switch.
- Vercel target: existing `printershero-development`, domain
  `dev.printershero.com`; root `.`; build `npm run build`; output `dist/public`.

Rollback was prepared as a restore of that DEV commit and those existing
Railway/Vercel settings. No destructive schema rollback is required: V2
migrations are additive. Rollback was not used.

## Database and identity readiness

The DEV-only safety gate passed in the existing Railway context. The approved
migration runner applied the pending additive V2 stream and its release check
passed all 55 checks. The post-apply status completed successfully with 206
recorded ledger positions.

Read-only identity readiness confirmed 383 users, 16 password identities, 20
organizations, 22 active memberships, 180 permission sets, 22 active Staff
assignments, and 11 eligible Staff accounts. No identity, permission, or
business data was created for this validation.

## Promotion and deployments

`dev` was fast-forwarded without force push or cherry-pick drift:

1. `be4e54d6` switched the existing DEV targets to the V2 topology.
2. `ac978d58` fixed the V2 UI's self-contained Vercel build by declaring its
   animation stylesheet dependency and using a portable build command.
3. `85f9bca0` fixed a deployed V2 toolbar/session-control overlap.

Railway now builds with `npm run v2:server:build`, starts with
`npm run v2:server:start`, and health-checks `/health`. Its final deployment
completed successfully. Vercel now builds the same existing project from
`v2/ui`, using `npm install --include=dev`, `npm run build:vercel`, and `dist`.
Its final production deployment completed successfully from `85f9bca0`.

No MAIN branch, production service, production Vercel project, parallel
database, service, or domain was changed.

## Live proof

- `https://api-dev.printershero.com/health` returned V2 JSON `status: ok`.
- `/ready` returned V2 JSON `status: ready`.
- `/version` returned service `printershero-v2` and commit `85f9bca0`.
- `https://dev.printershero.com` served the V2 shell and V2 login; the
  unauthenticated `/v2/auth/session` response was JSON `401`, never SPA HTML.
- All required SPA route paths, including parameterized representative paths,
  returned the V2 SPA document rather than hosting `404`s. Browser direct
  navigation to Products plus back/forward completed successfully.
- Real DEV Staff browser validation covered invalid-login rejection, valid
  login, active organization `org_titan_001`, permission-filtered navigation,
  logout, re-login, and session restoration after refresh. The authenticated
  V2 session control rendered after restore. The UI logout demonstrates the
  CSRF-protected session action in the real browser flow.

The available QA organization truthfully contains zero configurable products,
quotes, open orders, and invoices. The corresponding V2 screens loaded their
valid empty states without browser errors. No workflow records were invented;
therefore full Quote-to-Refund execution is recorded as a **TEST_DATA_LIMITATION**,
not evidence of a runtime or business-integrity failure. V2 continues to retain
M5's V1 tax-parity status of `INSUFFICIENT_EVIDENCE`.

## Visual, appearance, and responsive validation

The authenticated V2 Command Center, Quotes, Products, and Appearance screens
were checked in the live browser. The one material desktop collision between
the staff session control and V2 toolbar was fixed in `85f9bca0` and rechecked.

The Appearance screen exposed the six approved themes and visual options. A
Modern Dark selection persisted after a browser refresh. A 390px-wide narrow
check had no horizontal overflow and preserved navigation and sign-out access.
Its dense Command Center presentation is a later mobile-hardening concern, not
a workflow blocker.

## Defects and disposition

| Classification | Finding | Resolution |
| --- | --- | --- |
| DEPLOYMENT_DEFECT | First Vercel rebuild could not resolve `tw-animate-css`. | Fixed in `ac978d58`; local build/check and final Vercel build passed. |
| UI_CONVERGENCE_DEFECT | Fixed Staff session control overlaid the V2 toolbar. | Fixed in `85f9bca0`; live desktop and narrow revalidation passed. |
| TEST_DATA_LIMITATION | QA tenant has no commercial/operational/financial records for a safe end-to-end flow. | No test data fabricated; empty-state behavior and read routes were verified. |

## Final status

| Area | Result |
| --- | --- |
| Static validation | passed: focused UI production build, TypeScript check, diff check |
| Migration validation | passed: DEV safety preflight, additive apply, integrity release check |
| DEV deployment | passed: final Railway and Vercel deployments successful |
| DEV auth / browser | passed: real Staff login, logout, re-login, refresh restore |
| DEV routing | passed: V2 SPA routes and representative browser history navigation |
| DEV visual / responsive | passed: desktop collision fixed; narrow no-overflow sanity check |
| MAIN validation | unchanged; MAIN was not touched |

**Next action:** inspect the reconstruction master plan and identify the next
milestone; do not start it in this validation task.
