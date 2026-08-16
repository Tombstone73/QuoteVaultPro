# M2.3 — Production Domain Foundation

## Ownership and unit of work

Production owns durable execution of one frozen `ProductionUnitRequirement` using one exact production `ArtworkAssignment`. `ProductionWork` is the stable identity for that evidence; it is never an Order- or OrderLine-wide status. A double-sided line has independent Front and Back works, even when one `ArtworkFile` is explicitly assigned to both usages. Page and layer are carried from the immutable requirement and assignment evidence.

`ProductionAttempt` is an ordered execution history below a work. Starting an attempt records its typed station (`flatbed` or `roll`), operator attribution, and attempt kind (`initial`, `reprint`, or `correction`). Good and waste output may be accumulated only while active. Completion freezes its evidence. Reprints are new attempts, never rewrites of a completed run.

## Cross-domain boundaries

- Sales owns the ordered quantity and OrderLine commercial identity.
- Product/PBV2 owns the required-unit rule; Sales freezes that requirement on the OrderLine.
- Artwork owns the file and assignment truth; Production references exact immutable production usage evidence.
- Prepress remains the owner of preparation. Where the frozen Route contains Prepress, Production eligibility requires a completed Prepress unit for the exact assignment.
- Routing remains the owner of the coarse current step. Production reads current `production` eligibility and does not write, rebuild, or complete route instances.
- Fulfillment remains the customer-handoff authority. `completedGoodQuantity` and `unitQuantitySatisfied` are operational visibility only. They are never a pickup/shipment ceiling; a 100-unit double-sided line therefore has two 100-side execution targets, not 200 finished commercial units.

## Quantity and aggregate semantics

Each work snapshots the OrderLine ordered quantity as its execution target. An attempt completion means that attempt is historically complete; it does not mean the unit target is satisfied. A work is derived as satisfied only when the sum of good quantities on completed attempts reaches its target. Waste does not count. Extra or reprint output remains truthful attempt history. No aggregate is persisted as a stale Production status, and no route completion is produced in M2.3.

## Physical and transaction invariants

`v2_production_works` has tenant-safe FKs to order lines, frozen requirement rows, artwork assignments/files, and optional completed Prepress evidence. A trigger confirms exact side/page/layer/order evidence and rejects deletion or evidence mutation. `v2_production_attempts` has unique `(organization, work, sequence)`, one active attempt per work, non-negative quantities, typed stations/kinds, tenant-safe work linkage, and a trigger that makes completed attempts immutable.

All mutations use M0 operation reservation, Principal attribution, shared Audit, and caller-owned PostgreSQL transactions. Work creation converges by the unique artwork-assignment identity. Work locking serializes attempt sequencing and output updates; failed hooks roll back work/attempt, audit, attribution, and operation result together.

## UI and future seams

Lovable Flatbed/Roll, Kanban, Calendar, equipment selection, material consumption, production alerts, scheduling, and Fulfillment UI are deferred. Flatbed/Roll are station keys, not separate persistence universes. Specific equipment and additional station types require a future Production-owned registry decision. Routing aggregate completion remains a typed future composition over required unit satisfaction; M2.3 intentionally does not advance Routing.

### UI/domain reconciliation

- **Flatbed / Roll:** Production-owned destination projection; the M2.3 typed keys support it without creating two data models.
- **Kanban / Calendar:** future Production read projections, not persistence states.
- **Production Ready / Release / route-advance controls:** cannot be wired to an attempt completion. They combine unit satisfaction with Routing permission (and eventually Production/Fulfillment policy). They remain deferred rather than being persisted as Production state.
- **Material and production alerts:** require Inventory and a separately designed downstream-handoff owner; no mock data is made durable.
