# M7.8A parity closure report

## M7.8D CRM commercial account and billing recipient closure

M7.8D makes the existing Customer policy facts operational in V2 without
creating a parallel pricing or finance authority. Staff with `customer.edit`
can maintain payment terms, an explicitly configured (including $0) credit
limit, and tax-exemption evidence. Credit exposure is a read-only aggregate
from V2 invoices, payment allocations, and refund allocations; it is warning
context, not a new fulfillment or sales blocker. New Quotes and Orders resolve
the Customer's default terms only when the caller did not select terms, then
store the resolved value in the existing immutable sales snapshot. Existing
documents never reprice or change terms because a Customer policy changes.

Billing recipient selection is relationship-owned: active, scoped Contacts can
be marked as billing recipients. The existing invoice delivery resolver already
uses all active billing recipients before primary/customer-email fallback and
audits each actual send. Pricing agreements remain the only customer-specific
commercial price authority; legacy pricing tiers and mutable customer balances
are deliberately not exposed. Internal account context uses a staff-only,
append-only `customer_notes` entry path; notes are not returned by Portal,
documents, or delivery DTOs.

## M7.8E Orders sales-desk closure

V2 Orders now carry a tenant-scoped, staff-only operational note per line. The
note is distinct from description, pricing, tax, and customer documents. A
duplicate line creates a new identity and re-resolves the current Product
configuration and canonical price; it does not clone price evidence or artwork.
Exact-set line reordering persists only presentation/document sequence and is
audited without changing line identity, configuration, pricing, Production, or
Fulfillment allocations. The existing Pickup/Shipping/Local delivery request,
destination snapshot, and instructions remain Sales-owned and project to
Fulfillment. Once an immutable handoff exists, request changes fail closed and
must use the Fulfillment recovery path.

Dedicated DEV QA validation now proves that boundary end-to-end: a new
fulfillment-only QA Order accepted a pre-handoff Pickup-to-Shipping update,
recorded one canonical provider-free shipment handoff for its one available
unit, then rejected a Local Delivery/destination/instruction replacement with
the server's `409 CONFLICT` response. The handoff count remained one and the
Shipping request snapshot remained unchanged after the rejected command.

## M7.8F Artwork / Prepress throughput closure

The active V1 Prepress surface is `/production/prepress`, not the older
unlinked manual queue or standalone `/prepress` diagnostic tool. Its source
proves station/status/rush/search/sort controls, unbounded selection, a
client-side sequential bulk loop, per-line original-file ZIP, controlled
material overrides, and durable Combined Runs. Combined Runs are not a visual
convenience: V1 persists run/member/allocation state and downstream Production
uses it. M7.8F therefore does not reproduce that mutable entity under another
name.

V2 now closes the safe workboard throughput subset using existing canonical
owners: server-paged search now includes frozen station and readiness filters;
the workspace provides page-scoped individual/select-visible selection capped
at 50; and one authenticated bulk command locks and re-reads every selected
Prepress unit before invoking the existing single handoff authority. The
command is all-or-nothing, has one idempotent request record, uses stable lock
ordering for overlapping selections, and retains an attribution/audit event
for every real unit handoff. It does not create a batch, alter Artwork lineage,
or infer a destination. Stale/unready/foreign units fail the whole operation
without a browser-side partial loop.

V2 already supersedes V1's routine source/current Production Artwork context:
the workboard shows canonical source and current Production Art, revision
upload supersedes the current Production-Art assignment, and private
open/download rechecks `artwork.view`. V1's original-file ZIP is a narrow
per-line stream (it excludes bridged attachments and can skip unavailable
storage), so no broad multi-file bundle is claimed here. V1 material override
is a real inventory/commercial mutation and standalone preflight is an
unlinked TTL diagnostic utility; both remain owner decisions rather than new
Prepress-side free-form state.

The remaining M7.8F gap is explicit: persistent run/nesting and exception-run
recovery require an approved V2 Production-run and successor-cycle domain.
The existing `rework_requested` evidence is not misrepresented as that cycle.

## M7.8G canonical Production Run closure

M7.8G implements the source-proven V1 Combined Run outcome as a new canonical
V2 domain, rather than restoring V1's mutable queue controls. A Run holds
tenant-scoped, station/material-compatible ordered allocations, their frozen
Production-Art identity/version and a durable ordered event ledger. It creates
and terminalizes canonical attempts, records only good/waste output, and uses
the ordinary Production reconciliation path after every output, release,
cancellation and completion operation. A Run transition therefore cannot grant
Production, Fulfillment, or Order lifecycle credit itself.

Preparation is fail-closed: Start compares every frozen artwork reference to
current canonical Production Artwork and returns a deterministic stale conflict
when it differs. Draft/Ready Runs may refresh preparation explicitly; started
Runs retain the execution Artwork as historical truth. Partial or zero-output
members can be terminally released/cancelled without losing output or crediting
the unused reservation. Normal subsequent Run creation can reserve the
remaining work, so recovery is not a special successor bypass. Flatbed and Roll
share this state machine and now display the authoritative event history.

The remaining decisions are narrow and explicit. V1 evidence proves durable
membership/order but not persistent placement geometry, so nesting/layout is
**SUPERSEDED** by persistent Runs and no optimizer/geometry was added. A Run
Sheet is **NOT REQUIRED / UNPROVEN**: no V1 document/PDF workflow or necessary
operator outcome was found. Original-file ZIP is an **OWNER DECISION REQUIRED**
because V1's narrow per-line stream is not evidence that a bundle is routine
launch scope beyond V2's private individual Artwork access. Material override
is also **OWNER DECISION REQUIRED** because it changes inventory/commercial
authority. Return-to-Prepress/revised-Artwork successor routing remains a
separate P1 domain decision; ordinary release/recovery does not claim it.

## M7.8H Return-to-Prepress successor-cycle closure

M7.8H replaces the former evidence-only rework request with one immutable,
tenant-scoped successor cycle. The predecessor Production work, frozen route,
attempts, output and Artwork lineage remain unchanged. The command snapshots
reason and output, terminalizes an active attempt as non-successful, blocks
future predecessor execution, creates one linked Prepress unit, and is
idempotent. The successor is completed and handed off using the canonical
Prepress path; its Production work carries only the predecessor's remaining
required quantity and its own identity/linkage.

An active or prepared Run reservation fails closed until the member is released.
Accepted good output remains valid Fulfillment evidence; the successor request
adds none. Cases A/B (zero or partial accepted good output) are covered. Case C
(accepted output later judged unusable) remains an explicit owner decision: no
silent subtraction or scrap disposition was introduced. Material override and
original-file ZIP remain their existing owner decisions.

## Result

**PASS WITH FINDINGS — source/contract parity closure; M7.8E is IMPLEMENTED +
DEV VALIDATED.** The confirmed P0
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
