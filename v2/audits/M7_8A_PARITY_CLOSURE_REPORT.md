# M7.8A parity closure report

## Result

**PASS WITH FINDINGS — source/contract parity closure.** The confirmed P0
operator reachability blockers are closed through canonical V2 authority. This
does **not** change the overall production cutover disposition: the P1 provider,
runtime, and owner-decision items remain open.

## Changes

- M7.8B closes the pre-shipment Fulfillment recovery safety gap. A prepared
  shipment now has immutable revision/allocation evidence, can be corrected or
  voided with an attributed reason, and reserves but never fulfills quantity.
  One server transaction revalidates the active revision and physical
  availability, materializes canonical per-Order handoffs, allocation lines,
  snapshots, and container attachments, then transitions the container to
  `SHIPPED`. A failed finalization rolls back all of those database facts.
  Browser code no longer creates handoffs or attaches them after shipping.
  Post-shipped quantity correction remains deliberately fail-closed pending a
  separately approved physical return/re-delivery/reversal authority.

- Added active customer pricing-agreement readback to the canonical commercial
  store/service and staff HTTP surface.
- Added bounded Customer-detail authoring for portal Product entitlement and
  customer commercial agreement replacement, protected by Product Edit plus
  Pricing Configure capability.
- Added Finance `Issue Invoice` visibility for draft V2 Invoices, protected by
  Invoice Issue capability and CSRF. The command remains the existing Billing
  application service; no browser-created Invoice state was added.
- Added focused UI and HTTP contract coverage.
- Restored the existing canonical Artwork delivery path to the generic Artwork
  workspace: authorized staff can preview supported private files in-browser,
  open them in a separate tab, or request download. The browser receives only
  the opaque Artwork file identifier; the existing server route rechecks the
  tenant principal and `artwork.view` capability before resolving file bytes.
  No storage key, public URL, or new Artwork authority was added.
- Corrected stale Quote findings: the current V2 surface already mounted
  duplicate, open-quote edit/revision, terminal void/decline, line reorder,
  and PDF preview. This continuation adds the missing protected Quote Artwork
  open/download affordance on the same canonical Artwork delivery route.
- Exposed the existing immutable Production `wasteQuantityDelta` authority in
  both the shared station rail and Flatbed controls. Waste-only output is now
  possible; it never satisfies good quantity, advances Fulfillment, or creates
  material-consumption records.

## Audit outcome

The complete matrix is in `M7_8A_V1_V2_CURRENT_PARITY_MATRIX.md`. The operator
closure queue and waiver decisions are in `M7_8A_OPERATOR_PARITY_GAPS.md`.
The actual V1 audit reference was local `main` at `29b99eb`; its divergence from
`origin/main` was recorded as provenance, not reconciled or modified.

The continuation audit normalized **66 current operator capability groups**.
This is deliberately not a component-count: one group can contain multiple V1
controls where they produce the same business result. At the current source
state, 33 groups are parity/superseded, 17 are partial, 10 are missing or
unreachable, and 6 require an explicit business decision before being treated
as launch scope. The three P0 reachability findings are closed. Three additional
routine UI findings—generic private Artwork access, Quote Artwork access, and
Production waste capture—have also been closed using existing protected or
canonical authority. These counts
are source/contract evidence; deployed-role and provider behavior remains a
separate DEV validation requirement.

## Validation

- Direct TypeScript checks for `v2/tsconfig.json` and `v2/ui/tsconfig.json`
  passed with incremental output disabled.
- V2 import-boundary check and production Vite UI build passed. The UI build
  reports the pre-existing large-chunk advisory only; it is not a build error.
- The Artwork workspace visual contract and the production Vite build passed
  after the private-access change. An attempted neighboring order-line Artwork
  visual test remains blocked by its pre-existing expectation of lower-case
  `customer supplied` while its fixture renders `Customer Supplied`; this
  commit does not alter that component or test. The existing Jest route suite
  correctly refused to start because this environment has no safely named
  `TEST_DATABASE_URL`; no database test target was supplied or changed.
- Focused Product, Finance, Customer workspace, customer-commercial HTTP,
  customer-pricing, and Sales-integration contracts passed.
- `npm` was unavailable in the current process PATH; direct Node/TypeScript and
  `tsx` invocations were used as the equivalent local checks.
- No production, provider, MAIN, or deployment action occurred.

## Required next decisions

The M7.8B follow-on has now implemented the atomic container/finalization and
immutable prepared-correction model. The remaining Fulfillment decision is
strictly post-shipped: approve a separate physical return/re-delivery/reversal
authority if the business needs to alter shipped quantities. Production
exceptions now have a canonical append-only interruption ledger for holds,
resumes, notes, and a blocking Prepress-rework request. The request snapshots
the current output but does not mutate an attempt, route, Prepress handoff,
Artwork lineage, Fulfillment authority, or sibling work. A return-to-Prepress
rework bridge still needs to preserve
frozen Artwork, attempt, Prepress, and routing evidence. They remain
decision-ready bounded domain milestones, not hidden controls.

No additional broad parity implementation should start automatically. The next
bounded action is an owner decision on the remaining P1 queue, especially
runtime/provider validation and the exact sales/shop-floor routines required at
launch.
