# M7.7D — service-fee Fulfillment projection

## Root cause and intended behavior

The immutable, frozen workflow intent is the authority. `service_fee` has no Production or physical Fulfillment obligation: the lifecycle policy permits closure without a handoff and the Fulfillment mutation service exposes zero supply.

The operator read model did not follow that authority. It selected every sales line, so a service-fee-only Order appeared in the Fulfillment workspace as awaiting Production with commercial quantity remaining. The mutation path still rejected a handoff, but the queue was misleading.

## Repair

`PostgresFulfillmentWorkspaceReads` now filters unallocated frozen `service_fee` lines at the server-owned projection boundary. Its paginated list and single-Order read use the same SQL `EXISTS` predicate before `LIMIT`, so service-fee-only Orders are excluded without short pages and mixed Orders retain their physical lines.

The predicate deliberately keeps unknown frozen workflow evidence visible for investigation. It also retains a service-fee line with an existing immutable handoff, allowing any historical anomaly to remain auditable rather than being hidden.

No lifecycle, commercial, financial, migration, or Fulfillment mutation authority changed.

## Evidence

- Focused pure projection regression passed.
- Existing Fulfillment supply, Order lifecycle, and anomaly-presentation tests passed.
- V2 server/UI type checks, import boundaries, and production UI build passed.

DEV source deployment/revalidation is recorded separately. A live service-fee fixture was not created because the dedicated DEV QA provisioner is not configured for this session; no existing QA record was repurposed.
