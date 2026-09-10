# M7.8A parity closure report

## Result

**PASS WITH FINDINGS — source/contract parity closure.** The confirmed P0
operator reachability blockers are closed through canonical V2 authority. This
does **not** change the overall production cutover disposition: the P1 provider,
runtime, and owner-decision items remain open.

## Changes

- Added active customer pricing-agreement readback to the canonical commercial
  store/service and staff HTTP surface.
- Added bounded Customer-detail authoring for portal Product entitlement and
  customer commercial agreement replacement, protected by Product Edit plus
  Pricing Configure capability.
- Added Finance `Issue Invoice` visibility for draft V2 Invoices, protected by
  Invoice Issue capability and CSRF. The command remains the existing Billing
  application service; no browser-created Invoice state was added.
- Added focused UI and HTTP contract coverage.

## Audit outcome

The complete matrix is in `M7_8A_V1_V2_CURRENT_PARITY_MATRIX.md`. The operator
closure queue and waiver decisions are in `M7_8A_OPERATOR_PARITY_GAPS.md`.
The actual V1 audit reference was local `main` at `29b99eb`; its divergence from
`origin/main` was recorded as provenance, not reconciled or modified.

## Validation

- Direct TypeScript checks for `v2/tsconfig.json` and `v2/ui/tsconfig.json`
  passed with incremental output disabled.
- V2 import-boundary check and production Vite UI build passed. The UI build
  reports the pre-existing large-chunk advisory only; it is not a build error.
- Focused Product, Finance, Customer workspace, customer-commercial HTTP,
  customer-pricing, and Sales-integration contracts passed.
- `npm` was unavailable in the current process PATH; direct Node/TypeScript and
  `tsx` invocations were used as the equivalent local checks.
- No production, provider, MAIN, or deployment action occurred.

## Required next decisions

No additional broad parity implementation should start automatically. The next
bounded action is an owner decision on P1-01 through P1-10, especially runtime
provider validation and the exact sales/shop-floor routines required at launch.
