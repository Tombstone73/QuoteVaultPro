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
| P1-01 | CRM commercial account | terms, credit limit/balance, tax/billing recipient and internal account-note authority | staff must keep commercial-account facts outside V2 | decide whether V2 is commercial-account authority at launch |
| P1-02 | Quotes/Orders | duplicate/revise/void, line duplication/reorder, line notes and richer fulfillment header entry | slower manual recreation; no data integrity workaround is authorized | define minimum sales-desk ergonomics for launch |
| P1-03 | Artwork/Prepress | generic private-file preview/download, batch/nesting/exception-run controls | operators must use the canonical owning workflow and may lack bulk throughput tools | identify launch-volume requirements and exact owner workflow |
| P1-04 | Production | pause/reopen, machine/printer selection, waste/exception and calendar controls | shop-floor exception work is manual/outside V2 | determine which controls are mandatory versus later operations tooling |
| P1-05 | Fulfillment | prepared-shipment recovery/detail and canonical combined-shipment document | shipment recovery/document scope can be ambiguous | approve a single combined-slip scope and required recovery flow |
| P1-06 | Portal | final document/profile/configuration and authenticated live-flow validation | customer launch scope may be incomplete despite source contracts | nominate portal launch acceptance cases and authorize DEV validation |
| P1-07 | Inbound/provider | Gmail read scope, attachment binary adoption and provider validation | intake remains deterministic/manual rather than live-provider sourced | authorize a bounded Gmail-read milestone |
| P1-08 | Shell | permission-scoped global search and notification authority | users navigate through module worklists rather than global command search | waive or define a scoped search contract |
| P1-09 | Inventory/procurement | purchasing and complete inventory operator workflows | material operations remain limited to current reservation/consumption foundation | decide whether procurement is launch scope |
| P1-10 | Runtime/providers | production OAuth, webhook and worker-topology validation | no safe production release claim | retain as mandatory M7 cutover-control evidence |
| P1-11 | Fulfillment safety | reopen prepared shipment; immutable correction/reversal workflow | operators cannot safely recover an interrupted or incorrect shipment container in V2 | implement a canonical correction/recovery model before busy dispatch launch |
| P1-12 | Production exceptions | pause/hold/reopen/return-to-prepress, production notes and waste | operators may need off-system exception handling | implement immutable exception facts and owner-return flow; do not mutate attempts |
| P1-13 | Artwork access | private generic artwork preview/download/revision affordance | staff cannot inspect/download customer/source artwork from the Artwork workspace | add scoped content view/download using existing private content authority |
| P1-14 | Sales documents | Quote artwork/PDF/print evidence and exact V2 quote document route validation | quote desk may lack customer-facing output/artwork context | validate mounted document path; add only a canonical Quote-scoped document/artwork projection if absent |

## Classification rules

- P0 means no canonical, safe path exists for a launch-critical operation.
- P1 means a real routine operator gap; it cannot become acceptable merely by
  hiding its navigation entry.
- P2 improvements (layout density, breadcrumbs, historical V1 styling) are not
  represented as feature parity claims and do not authorize data-model changes.
