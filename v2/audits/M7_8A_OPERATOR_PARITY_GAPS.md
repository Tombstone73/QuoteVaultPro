# M7.8A operator parity gaps and closure decisions

## Closed P0 reachability blockers

| ID | Operator need | Closure | Guardrail |
| --- | --- | --- | --- |
| P0-01 | Create a sellable Product | Confirmed existing New Product Draft Builder and canonical initial-Draft command | Product is not active until typed Draft validation/publish succeeds |
| P0-02 | Issue an eligible Order-backed Invoice | Finance detail now exposes `Issue Invoice` to `invoice.issue` authority | legacy and issued records are excluded; server owns issuance/idempotency |
| P0-03 | Maintain a customer's portal catalog and commercial price | Customer detail now exposes current entitlements and active agreements with capability-gated mutations | React never computes a commercial price; Sales freezes server evidence |

## P1 closure queue

These are intentionally decision-ready, not silently deferred. Each must be
implemented before cutover or receive an explicit owner waiver that accepts the
listed operational consequence.

| ID | Area | Missing or partial routine capability | Consequence if waived | Recommended owner decision |
| --- | --- | --- | --- | --- |
| P1-01 | CRM commercial account | **CLOSED:** terms, typed/unset credit policy, tax policy, active billing-recipient authority and append-only internal notes | M7.8D derives A/R from V2 Finance, freezes terms/tax in new commercial records, and never restores mutable legacy balance/tier pricing | no additional action for the audited commercial-account capability |
| P1-02 | Orders sales desk | **CLOSED:** line note, current-pricing duplicate line, persisted reorder, fulfillment request/destination/instructions | Sales owns the request snapshot; Fulfillment owns immutable physical handoffs and blocks later request rewrites | no additional action for the audited sales-desk capabilities |
| P1-03 | Artwork/Prepress | **PARTIAL:** controlled material override and any approved original-file bundle | M7.8G now provides persistent ordered Run membership, immutable prepared Production-Art identity, stale-preparation rejection/refresh, and normal successor recovery; private individual Artwork access remains canonical | decide whether effective-material/inventory authority or a bounded original-file bundle is a launch requirement; do not substitute free-form UI state or a client ZIP loop |
| P1-04 | Production | machine/printer selection and calendar controls | M7.8H closes Return-to-Prepress through an immutable successor cycle; M7.8H follow-up closes attributed accepted-good rejection/scrap without rewriting output history, and only against unfulfilled, non-prepared-shipment supply | separately decide whether canonical scheduling is required |
| P1-05 | Fulfillment | **RECOVERY CLOSED:** prepared-shipment detail, correction, void, server-held reservations, and atomic finalization | recovery is now a canonical append-only state flow; combined-container document scope remains intentionally separate | decide whether a single combined-container manifest is required beyond canonical per-handoff documents |
| P1-06 | Portal | final document/profile/configuration and authenticated live-flow validation | customer launch scope may be incomplete despite source contracts | nominate portal launch acceptance cases and authorize DEV validation |
| P1-07 | Inbound/provider | Gmail read scope, attachment binary adoption and provider validation | intake remains deterministic/manual rather than live-provider sourced | authorize a bounded Gmail-read milestone |
| P1-08 | Shell | permission-scoped global search and notification authority | users navigate through module worklists rather than global command search | waive or define a scoped search contract |
| P1-09 | Inventory/procurement | purchasing and complete inventory operator workflows | material operations remain limited to current reservation/consumption foundation | decide whether procurement is launch scope |
| P1-10 | Runtime/providers | production OAuth, webhook and worker-topology validation | no safe production release claim | retain as mandatory M7 cutover-control evidence |
| P1-11 | Fulfillment safety | **PRE-SHIPMENT RECOVERY CLOSED:** append-only prepared revision correction/void and atomic handoff finalization | prepared work can be safely recovered without changing fulfillment history; post-shipped physical return/reversal is intentionally fail-closed | owner must approve a separate return/re-delivery/reversal domain before any shipped quantity correction is added |
| P1-12 | Production exceptions | **CLOSED:** previously accepted-good rejection/scrap disposition | Append-only attributed disposition evidence reduces usable-good only; it cannot exceed attempt output or unfulfilled line supply and fails closed while a prepared shipment reservation exists | no silent quantity subtraction; post-shipment returns/reversals remain a separate Fulfillment domain |
| P1-13 | Artwork access | **CLOSED:** generic Artwork view/open/download | Artwork detail now uses the existing server-authorized private-content transport; assignment/revision ownership remains unchanged | no additional action for basic private access |
| P1-14 | Sales documents | **CLOSED:** Quote duplicate/void/reorder, Quote Artwork, and Quote PDF access | mounted canonical Quote controls now expose protected Artwork open/download and PDF preview; Quote lifecycle remains server-owned | no additional action for the audited Quote/document capabilities |

## Classification rules

- P0 means no canonical, safe path exists for a launch-critical operation.
- P1 means a real routine operator gap; it cannot become acceptable merely by
  hiding its navigation entry.
- P2 improvements (layout density, breadcrumbs, historical V1 styling) are not
  represented as feature parity claims and do not authorize data-model changes.

## M7.8G production-run closure

- **Run Sheet — NOT REQUIRED / UNPROVEN.** The audited active V1 source proves
  `production_runs`/members and per-line original-file ZIP, but no Run Sheet
  document/PDF workflow or required operator outcome. No duplicate document
  renderer was added.
- **Nesting/layout — SUPERSEDED / CLOSED.** The V1 evidence proves persistent
  Run membership and order, not persistent placement geometry. M7.8G supplies
  that durable membership/order; no auto-nesting or layout metadata is claimed.
- **Original-file ZIP — OWNER DECISION REQUIRED.** V1 has a narrow per-line
  stream, while V2 already gives scoped private individual Artwork access. The
  audit does not prove a multi-file bundle is routine launch scope.
- **Material override — OWNER DECISION REQUIRED.** It is an inventory/commercial
  authority; free-form station material mutation remains deliberately absent.

M7.8G closes persistent station-specific Runs, canonical Run execution and
recovery, successor Runs, stale-Artwork preparation/refresh and durable
operator history. Normal Production reconciliation remains the only source of
Production, Fulfillment, and Order lifecycle credit. The append-only rejection/
scrap disposition closes the formerly unresolved accepted-good Case C without
rewriting output history or authorizing a post-shipment reversal.
