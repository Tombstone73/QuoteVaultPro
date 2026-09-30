---
name: printershero-change-verification
description: Evidence-based verification workflow for changes in the PrintersHero/QuoteVaultPro repository. This skill should be used after modifying code under server/, shared/, client/, or v2/, to decide which typecheck, test, boundary, and rehearsal gates actually apply, and to report honestly what was and was not run.
metadata:
  category: development
  project: QuoteVaultPro
  status: draft
  verified-against: origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a
---

# PrintersHero Change Verification

Selects the narrowest sufficient verification set for a change and forbids claiming verification that did not happen.

> **Verify before trusting.** Facts below were read from `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a`.
> The script list changes constantly. **Re-read `package.json` `scripts` rather than trusting this file.**
> Unverified statements are `REQUIRES CONFIRMATION`.

## Step 0 — confirm the target

`git rev-parse HEAD` must equal the commit you were asked to verify. An obsolete branch produces
confident, wrong results.

## Step 1 — classify the change

| Changed area | Gates |
| --- | --- |
| `client/src/**`, `shared/**`, `server/**` (V1) | A |
| `v2/src/**`, `v2/infrastructure/**` | B |
| `v2/ui/src/**` | C |
| `server/db/migrations_v2/**` or migration scripts | D (mandatory), plus `printershero-database-safety` |
| `package.json` scripts, `tsconfig*.json`, jest/playwright config | A + B + C |
| `railway.json`, `vercel.json`, `.github/workflows/**` | A + B + D + `printershero-release-validation` |
| Anything that moves a write across a module boundary | B + `printershero-architecture-audit` |

## Step 2 — gates

### A — V1 and shared

```
npm run check          # tsc: client/src, shared, server (root tsconfig excludes **/*.test.ts)
npm test               # jest, root config
npm run test:client    # jest --config client/jest.config.js
```

Root `jest.config.js` matches **only** `**/tests/**/*.test.ts` and `**/tests/**/*.spec.ts`, uses
`ts-jest` with `diagnostics: false` (test files are not type-checked), and loads
`server/tests/setup.ts`. Files named `*.pure.ts` are **not** matched by it.

### B — V2 core

```
npm run v2:check       # tsc -p v2/tsconfig.json
npm run v2:boundaries  # node v2/scripts/check-import-boundaries.mjs
npm run v2:ownership  # SQL write-target ownership and exact debt baseline
npm run v2:validate   # canonical deterministic completion gate
```

`v2/tsconfig.json` `include` is `src/**/*.ts`, `infrastructure/**/*.ts`, `types/**/*.d.ts`.
It does **not** cover `v2/tests`, `v2/scripts`, or `v2/browser`.

### C — V2 UI

```
npm run v2:ui:check
npm run v2:ui:test     # a long tsx && chain of test files under v2/ui/src
```

### D — migrations

```
npm run db:migrations:v2:preflight
```

## Step 3 — canonical validation and separate environment checks

Run `npm run v2:validate` before declaring a V2 change complete. It combines
static checking, architecture checks and negative fixtures, classified
deterministic tests, and migration/history integrity. Its output lists gate
results and environment-dependent suites outside the deterministic scope.
A failed gate remains a failure; missing prerequisites are not an implicit PASS.
Read the current runner and classification manifest under `v2/scripts/` to
identify which tests run and why others need separate guarded commands.

Useful entrypoints:

```
npm run v2:tests:classify       # completeness, runner style, and safety categories
npm run v2:test                # classified deterministic core suites
npm run v2:ui:test:classified   # classified deterministic UI suites
npm run v2:architecture:test   # invalid and legitimate in-memory fixtures
npm run v2:test:harness        # safety, coverage, and timeout regressions
npm run v2:validation:report   # exact results from the last canonical run
npm run v2:test:db             # explicit safe-database guards before imports
npm run v2:test:qa             # separate clone-only rehearsal/SQL fixtures
```

The manifest classifies the original 249 test-name files as 244 deterministic
and 5 guarded DB-import suites. All 126 pure suites are reachable: 123 in the
deterministic gate and 3 guarded. The inventory also includes 84 UI suites and
separate QA/helper/asset files. These are harness-time measurements, not fixed
targets; `v2:tests:classify` must detect new or missing files. Never reclassify a
failed deterministic test as manual or environmental just to make CI green.

Database-backed, provider, browser, QA, and cutover/rehearsal work are separate
from this deterministic gate. Run the relevant explicitly guarded command when
the change requires it and report BLOCKED if prerequisites are unavailable.
Never weaken a database guard or activate production credentials to get green.

### Historical test reachability (before this guardrail harness)

The V2 suite is **not** one runner. At the audited commit `package.json` had 128 `v2:*` scripts, and
most domain tests are standalone files run with `tsx`, including many named `*.pure.ts` and
`*.contract.test.ts`. They do not run under `npm test`. Find the script that owns your file:

```
node -e "const s=require('./package.json').scripts;for(const [k,v] of Object.entries(s))if(v.includes(process.argv[1]))console.log(k+' => '+v)" <fileName>
```

A literal filename search of package scripts is historical evidence, not the
current reachability test: manifest-driven runners make tests reachable without
spelling every filename in package.json. Use the canonical classification check.

Some rehearsals need a disposable clone database and fail closed without it. Run the one for the
domain you changed, not the whole set. Domain families present at the audited commit:

| Area | Script prefixes (verify in `package.json`) |
| --- | --- |
| Foundation / persistence | `v2:m0:postgres` |
| Commercial spine | `v2:m1:quote`, `v2:m1:order`, `v2:m1:quote-conversion`, `v2:order-lifecycle:pure`, `v2:sales-*:pure` |
| Pricing / products | `v2:p4`…`v2:p7*`, `v2:pricing:parity:pure`, `v2:formula:*` |
| Routing / artwork / proofing / prepress / production | `v2:m1:routing`, `v2:routing:lifecycle*`, `v2:m2:*`, `v2:order-artwork:*`, `v2:prepress:hygiene` |
| Fulfillment / billing / payments | `v2:m3:*`, `v2:fulfillment:integrity:pure`, `v2:stripe-ingress:pure` |
| Accounting / email | `v2:quickbooks-*:pure`, `v2:invoice-email:pure`, `v2:email-integration:pure` |
| Parity | `v2:m5:commercial-parity`, `v2:m5:operational-parity`, `v2:m5:financial-parity` |
| Cutover gates | `v2:m7_2d:cutover:pure`, `v2:m7_2e:write-free-gate*`, `v2:m7_2f:write-free-gate*`, `v2:m7_3a:cutover-evidence-gate*`, `v2:m7_3b:production-executor:*` |

### Files that the old harness did not reach (historical measurement)

The earlier audit reported 173 unreferenced files out of 249, but the guardrail
remeasurement found **76 script references to only 75 unique exact test paths**
(one file was referenced twice). Therefore **174** of the original 249 test-name
files had no unique exact package-script reference. Literal filename matching
and Jest discovery are not proof of successful execution: the old root runner
also discovered self-running assertion files as if they were Jest suites.

- **70 were `*.pure.ts` files without an executable gate.** They matched no script and did not match the root
  Jest `testMatch`, so they only ran if someone invoked `tsx <file>` by hand. This included **all 11**
  replacement / shipment / shipping pure tests: `replacementObligations.pure.ts`,
  `replacementInvoice.pure.ts`, `replacementShippingEconomics.pure.ts`, `replacementObligationSequencing.pure.ts`,
  `shipmentContainer.pure.ts`, `shipmentContainerIdempotency.pure.ts`, `shipmentFinalizationAtomicity.pure.ts`,
  `shipmentEconomicsStaffRoute.pure.ts`, `shippingPricingPolicy.pure.ts`, `shippingEconomicsApplication.pure.ts`,
  `carrierShipment.pure.ts`.
- The other unreferenced test-name files include migration contract suites and
  self-running assertion programs. The old root Jest glob discovered them, but
  self-running files are not valid Jest suites. The canonical classification
  distinguishes the two instead of assuming discovery means execution.

When changing replacement, shipment, shipping-pricing, portal, inbound, or AI
code, use the current classification to select the runner and safety gate.
Do not infer Jest versus standalone execution from the `.test.ts` suffix.
Report the command, exact files, result, and any separate blocked suites.
The canonical runner is the completion gate; old named scripts alone are not.

## Architecture checks

`npm run v2:boundaries` and `npm run v2:ownership` enforce import/layer and SQL
write-target rules. Tests exercise invalid fixtures without editing production
files. Public contracts and reviewed composition remain distinct from direct
foreign-state mutations. Reads and lock-only SQL are not mutations.

Known violations are tracked as exact debt baseline entries with identifiers,
locations/patterns, reasons, and authoritative BD references. They are violations
awaiting removal, not permission: new instances must fail. No automated check
can resolve a BDR business decision or prove every dynamic SQL/transitive bridge
effect; inspect the checker diagnostics and its stated scope.

### Historical import-check coverage at the starting commit

`v2/scripts/check-import-boundaries.mjs` scans `v2/**` for import specifiers only. It does **not** read SQL.

- No import of `v2-poc`, `server/index`, `server/routes`, or `server/services` / `server/quickbooksService`,
  except **four** explicit single-file bridges: product publication, organization logo storage, and two QuickBooks
  provider bridges (`quickBooksBillingQueue.ts`, `quickBooksIntegrationReadiness.ts`).
- `src/interfaces/**` may not import `/repositories`, `/infrastructure/persistence`, `server/db`, or `pg`/`drizzle-orm`/`@neondatabase/serverless`.
- `src/authorization/**` is persistence-free and interface-free.
- The M1.4 temporary Staff authority resolver/issuer is quarantined to named files.
- `src/repositories/**` may not import interfaces; `src/application/**` and `src/domain/**` may not import interfaces, `client/`, persistence, or `server/db`.

Known limits at the audited commit: nothing restricts `v2/src/modules/**` imports; nothing restricts which
module's infrastructure may write which table; `src/interfaces/**` currently imports `infrastructure/*`
files directly (allowed, because only `/infrastructure/persistence` is blocked);
`v2/tests/importBoundary.test.ts` asserts only that the script exits 0. A green result means
"no import rule tripped," not "ownership is respected."

## CI

The deterministic V2 workflow runs the canonical command for relevant changes.
This is not evidence of DEV browser, provider, database, or production readiness.
Do not claim those gates passed from a deterministic CI result.

### Historical CI coverage at the starting commit

`.github/workflows/`: `migration-integrity.yml` (runs `db:migrations:v2:preflight` on migration-path changes),
`ai-operator-drift.yml` (build, nine named jest files, `knowledge:validate`, six generators, `git diff --exit-code`),
`project-add.yml`, `project-status.yml`, `smoke.yml`.
**No workflow runs `npm test`, `npm run check`, `npm run v2:check`, `npm run v2:boundaries`, or any `v2:*` rehearsal.**
CI will not catch a V2 regression. Run the gates locally and record them.

## Database safety during verification

Never point a test at a shared database. `safeTestDatabase.ts` and `cloneSafety.ts` are guardrails; see
`printershero-database-safety`. Do not weaken them to make a test run.

## Report honestly

```
Target commit:     <sha>
Gates run:         <command -> exit status -> what it did NOT cover>
Gates not run:     <command -> reason>
Tests with no owning script: <files>
Residual risk:     <specific>
```
