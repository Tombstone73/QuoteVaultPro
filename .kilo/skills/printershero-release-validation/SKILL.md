---
name: printershero-release-validation
description: Release-readiness validation for the PrintersHero/QuoteVaultPro repository (Railway backend, Vercel frontend). This skill should be used when preparing a release or deploy candidate, deciding whether a change is safe to ship, running pre-deploy validation, or recording validation evidence in a go-live log.
metadata:
  category: development
  project: QuoteVaultPro
  status: draft
  verified-against: origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a
---

# PrintersHero Release Validation

Sequence of gates and the evidence to record before a change reaches a shared environment.
Validation only. **This skill never deploys.**

> **Verify before trusting.** Facts below were read from `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a`.
> Re-read the config files named here. Unverified statements are `REQUIRES CONFIRMATION`.

## Step 0 — confirm what is being released

`git rev-parse HEAD`, then the highest tag in `server/db/migrations_v2/meta/_journal.json`. A validation
run against the wrong commit is worse than none.

## Targets (verified from config files)

| Target | Config | Behavior |
| --- | --- | --- |
| Railway backend | `railway.json` | `deploy.preDeployCommand: ["npm run v2:migrations:apply"]`. No build command, healthcheck, or restart policy declared in-repo. |
| Vercel frontend | `vercel.json` | Rewrites only: `/api/:path*` and `/objects/:path*` to `https://api-dev.printershero.com/...`, everything else to `/index.html`. The API host is **DEV-oriented** in the checked-in file. |

Build and start (from `package.json`): `npm run build` (vite build + esbuild `server/index.ts` +
`scripts/copy-migrations.mjs`), `npm start`, `npm run v2:server:build` (esbuild `v2/src/deployment/entry.ts`
to `dist-v2/server.js`), `npm run v2:server:start`, `npm run v2:ui:build`.

## Cutover corpus — read before any PROD-affecting change

The repository contains a large evidence set under `v2/audits/` (about 100 files: `M7_1_*` … `M7_8A_*`,
`POST_M6_*`) and a `v2/src/modules/cutover/` module. Key documents:

- `v2/audits/M7_1_WRITER_AUTHORITY_MAP.md` — states the rule: **V1 and V2 must never be simultaneous
  authorities** for payments, Stripe, QuickBooks, delivery/email, orders, prepress, production,
  fulfillment, inventory, or lifecycle; and that V2 worker code is *not* evidence of a live V2 runtime.
- `v2/audits/M7_2E_WRITE_FREE_GATE.md`, `M7_3A_CUTOVER_EVIDENCE_GATE.md`, `M7_3B_CUTOVER_EXECUTOR.md`.
- `v2/audits/M7_PRODUCTION_DEPLOYMENT_UNBLOCK.md`, `M7_5C_CUTOVER_GAP_REGISTER.md`, `M7_8A_*`.
- Also `docs/architecture/V2_CUTOVER_ROLLBACK_PLAN.md`.

Cutover gate implementations (pure, fail-closed, take an operator-collected JSON manifest; they do **not**
discover or stop processes):

| Script | Module | Requires |
| --- | --- | --- |
| `npm run v2:m7_2e:write-free-gate` / `v2:m7_2f:write-free-gate` | `v2/scripts/assertM72EWriteFreeGate.ts` → `cutover/writeFreeRuntimeGate.ts` | an evidence manifest |
| `npm run v2:m7_3a:cutover-evidence-gate` | `v2/scripts/assertM73ACutoverEvidenceGate.ts` → `cutover/cutoverEvidenceGate.ts` | env `M73A_CUTOVER_EVIDENCE_FILE` and `M73A_EXPECTED_PROD_HOST_SHA256_16` |
| `npm run v2:m7_3b:production-executor:prepare` | `v2/scripts/prepareM73BProductionCutoverExecutor.ts` | see script |
| `:pure` variants | `v2/tests/modules/*.pure.ts` | none |

A passing pure gate proves the gate logic, not the environment. Do not present it as production evidence.

## Validation sequence

### R1 — static

```
npm run v2:validate
npm run check
npm run v2:ui:check
```

The canonical V2 deterministic gate includes static validation, import/SQL
ownership checks, architecture negative fixtures, classified tests, and migration
integrity. It does not certify provider/browser/database readiness or settle a
business ownership ambiguity. Use `printershero-change-verification` for scope.

### R2 — tests

Choose by blast radius and **name the exact files run.** Before the new harness,
the guardrail remeasurement found 76 package-script references to **75 unique**
test paths out of the original 249 test-name files; the audit's 76-file count
included a duplicate reference. It also found 70 `*.pure.ts` files (including every replacement,
shipment, and shipping-pricing pure test) are run by nothing. See `printershero-change-verification`.

### R3 — migrations (mandatory when SQL or migration metadata changed)

```
npm run db:migrations:v2:preflight
npm run v2:migrations:status
```

`v2:migrations:apply` is the deploy hook; do not run it against a shared database as a "check".

### R4 — build and packaging

```
npm run build
```

Confirm `[Build] migrations_v2 packaged: N entries, highest idx = M (tag)`. Its absence means a stale `dist`.

### R5 — tenant, authority, and money spot checks

- Organization scoping is in SQL predicates, not only in the route (`requireOperationPrincipalScope` → `WRONG_TENANT`).
- New V2 routes sit behind trusted-host, session scope, and `requireV2CsrfToken` in `v2/src/interfaces/http/app.ts`.
- New capabilities are in `v2/src/authorization/capabilities.ts`; there is no wildcard administrator capability.
- **Money paths** (invoice totals, tax, shipping allocation, replacement invoices, refunds, QuickBooks queue):
  confirm which module is the *only* writer of each table you touch. Money written by a second module is a
  release risk, not a style issue. Use `printershero-architecture-audit`.
- **Provider side effects** (Stripe, QuickBooks, email): V2 workers use lease-based queues. Confirm the
  worker gate/env for the target environment and that V1 and V2 are not both live authorities for the same provider.

### R6 — manual validation log

Use the house format in `GO_LIVE_VALIDATION_LOG.md`: `PASS`, `PASS WITH GAP`, `FAIL`, `BLOCKED`, with the
environment, flow, and evidence. Record `PASS WITH GAP` when partially verified.
Automated tests and mutating reproductions use guarded disposable clones.
`v2/audits/M7_7E_QA_FIXTURE_MANIFEST.md` describes shared-DEV fixture provisioning
(`npm run qa:m78i-fixture`), which changes shared data and is NOT a test gate.
Do not run it as part of release validation or the canonical command. It requires
a separate, explicitly authorized operator provisioning task and its own target
and safety review; merely confirming that a target is DEV is insufficient.

## CI coverage

The deterministic V2 workflow runs `npm run v2:validate` for relevant changes.
Environment-dependent QA stays separate; unavailable required QA is BLOCKED,
not automatically satisfied by this workflow. DEV validation precedes MAIN;
promotion requires explicit human approval.

### Historical coverage at the starting commit

| Workflow | Trigger | Runs |
| --- | --- | --- |
| `migration-integrity.yml` | PR and push to `dev` on migration paths | `npm run db:migrations:v2:preflight` |
| `ai-operator-drift.yml` | PR and push to `dev` | `npm run build`, 9 named jest files, `knowledge:validate`, 6 generators, `git diff --exit-code` |
| `project-add.yml`, `project-status.yml` | issue/PR events | GitHub Project sync |
| `smoke.yml` | manual | placeholder |

**No workflow runs `npm test`, `npm run check`, `npm run v2:check`, `npm run v2:boundaries`, `v2:ui:test`, or any rehearsal.**
CI is not a behavior safety net. Run the gates locally and record them.

## Rollback

- Code: `git revert <sha>`; hosting redeploys. Migrations are **not** auto-reverted.
- Schema: forward-fix with a new migration. Never edit applied history (`printershero-database-safety`).
- A destructive down-migration on live commercial data is not an acceptable default; stop and assess.
- Session cookie behavior depends on same-origin `/api/*` via the Vercel rewrite; changing the API origin can invalidate sessions.

## Evidence template

```
Target commit:     <sha>            Highest migration tag: <tag>
Migration:         <none | NNNN_name.sql, preflight PASS>
Static gates:      check | v2:check | v2:ui:check | v2:boundaries -> <status>
Tests (exact files): <file -> command -> status>   Tests with no owning script: <files>
Build:             npm run build -> <status>; migrations_v2 packaged idx = <M>
Cutover gates:     <not applicable | which, with manifest source>
Manual validation: <GO_LIVE_VALIDATION_LOG entry -> PASS | PASS WITH GAP (<gap>)>
Not run:           <command -> reason>
Residual risk:     <specific>
Rollback plan:     <revert sha / forward migration>
```
