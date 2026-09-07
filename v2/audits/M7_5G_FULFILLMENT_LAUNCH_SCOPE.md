# M7.5G — Operational Fulfillment and Shipment Plumbing

## Canonical quantity and allocation model

V2 already records immutable, per-Order fulfillment handoffs and explicit
line allocations. The quantity projection remains authoritative:
`completedFulfillmentQuantity` is the sum of immutable pickup and shipment
allocations; `remainingFulfillmentQuantity` is the commercial line quantity
minus that sum; and `availableFulfillmentQuantity` is separately capped by
completed Production output for production-required work. Fulfillment-only
work deliberately has no fabricated Production row. Service-fee work has no
physical fulfillment supply.

The transaction locks Sales Order/line state before calculating availability,
uses the operation-request ledger for per-Order handoff retries, rejects
over-allocation and historical physical-integrity anomalies, and asks the
existing Order lifecycle service to recompute after every accepted or replayed
handoff. Fulfillment does not close Orders and does not alter invoices or
payments.

## Pickup, shipment, and documents

The Fulfillment workboard retains operator-selected partial pickup or shipment
handoffs, separately displays picked-up and shipped quantities, shows
remaining quantity, immutable history, and existing receipt/packing-slip
documents. Requested fulfillment is presented only as Sales context.

`0267_v2_fulfillment_shipment_containers` adds a forward-only physical
shipment container. Prepared containers have no allocation effect. An operator
may mark a container shipped with manual carrier, service, tracking, notes and
package-count facts, then attach existing immutable shipment handoffs. The
attachment rule requires the same organization, canonical customer, exact
destination, shipped container state, and an as-yet unattached shipment
handoff. Consequently a physical shipment can combine compatible Orders while
each source Order retains its own immutable allocation history.

The existing packing-slip snapshot renderer accepts optional immutable
shipment metadata. Carrier provider APIs are deliberately not implemented.
`CarrierProviderPort` defines only the future seam for rating, labels,
tracking, and voiding.

## Safety boundaries and remaining work

No carrier call, provider write, fulfillment reversal, or shipment attachment
changes allocation quantity. Prepared shipment editing is intentionally not
an allocation correction path. The new container commands are protected by the
existing trusted-host, CSRF, and `fulfillment.ship` authority boundary.

The backend/API plumbing and bounded V2 operator controls for manual shipment
metadata and combined handoff attachment are complete. See M7.5G.1 for the
operator workflow and remaining document-rendering limitation.

No temporary M7.5G agent worktrees or branches were created; all work was
integrated in the sole `dev` recovery worktree.
