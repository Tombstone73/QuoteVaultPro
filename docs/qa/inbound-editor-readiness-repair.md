# Inbound editor, pricing and current readiness repair

## Confirmed causes

- The inbound adapter converted width/height input text to numbers on every change. A trailing decimal point disappeared before the next keystroke. Ordinary New Order retains dimension text.
- Inbound alone rounded each dimension to whole feet before calling `PricingService.priceLineItem`. A 2.25 × 2-inch regression reached that service as 12 × 12 inches. Ordinary Order entry passes physical dimensions and lets canonical PBV2 pricing apply its configured rates, minimums and tiers.
- Overall readiness merged old server errors and historical AI missing-field decisions into the current checklist. Product selection was not reconciled like quantity or artwork. Line completion also omitted pricing readiness.
- Empty-option products did not initialize their active tree version. Pricing must wait for the resolved product contract without replacing existing staff selections.

## Boundaries

`shared/inboundOrderReadiness.ts` extracts the existing server review gates and selected-product checks for reuse by the working-draft UI. Evidence coverage, approval, stale snapshots, tenant permissions and transactional conversion remain server responsibilities. Actual evidence conflicts remain actionable. Resolved AI observations remain informational; missing-artwork warnings are retained as acknowledged history.

Partial decimal strings live in the existing per-record editing buffer, protect it against refetch, and commit numeric values on blur. This introduces no second persistence mechanism. Save Draft remains explicit.

Pricing uses the same canonical service as ordinary Order entry, with physical inch dimensions. Unresolved/inactive product identities and stale active tree versions cannot provide authoritative system prices. Explicit staff overrides remain separate and retain their exact total.

PDF page geometry is metadata. Valid finished dimensions govern pricing and production specifications. Size discrepancies are informational, with a deliberate Use PDF Dimensions action. Conversion carries identity-bound geometry and a Prepress note alongside finished dimensions. Unassigned source artwork is explicitly identified as unassigned; ownership, approval and production routing are unchanged. Quarantined files cannot contribute this metadata.

## Focused validation

- Scoped TypeScript: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --project node_modules/.cache/tsconfig.draft-reset.json --pretty false` (no full repository check).
- Focused component and adapter checks in `client/src/pages/inbound-orders.test.tsx` and `client/src/hooks/useInboundReviewDraftState.test.tsx`.
- Service/shared checks in `server/tests/inboundOrderReviewDraftService.test.ts` and `server/tests/inboundWorkingDraftReadiness.test.ts`.
- Disposable loopback PostgreSQL: `scripts/qa/test-inbound-postgres.ps1`, targeting the fractional-pricing, editable-persistence, stale-writer, held-Prepress, changed-evidence and foreign-tenant cases in `server/tests/inboundEmail.postgres.integration.ts`. Canonical pricing parity covers fractional sizes, configured minimums, quantity breaks and 24 × 36 inches at $4/sq ft = $24. Independent connections read saved drafts and converted Order specifications. Existing coverage preserves quantity 28 and an exact $165 override.
- Actual components in Chrome, 1440 × 900 at device scale 1: `e2e/local-inbound-workflow/verify-editor-repair.mjs`, `verify-draft-ownership.mjs`, and the ordinary New Order fixture `verify-order.mjs`. Local browser APIs/persistence are mocked, separately from real PostgreSQL coverage. The repair journey exercises keyboard catalog selection, partial decimals, current readiness, PDF warning, failed saves, background refetch, stale-save rejection and explicit saved-draft reload. Light/dark captures are under `node_modules/.cache/inbound-workflow/editor-repair-*.png`.

## Acceptance limits

The reported live Stickers product configuration and the exact $3.14/$3.46 prices have not been inspected. They are not declared mathematically incorrect. Controlled canonical pricing parity is established; actual live product rates/minimums/options still determine the correct price.

No operational customer request or Gmail record was changed. No migrations or automation controls changed. DEV/MAIN deployment and live validation are not part of this task. MAIN is not a push target.

Deployable but not yet live-validated.
