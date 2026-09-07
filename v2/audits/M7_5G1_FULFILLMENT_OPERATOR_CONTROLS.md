# M7.5G.1 — Fulfillment Shipment Operator Controls

## Operator workflow

The Fulfillment workboard now includes a bounded shipment composer. An
authorized operator selects currently loaded eligible lines and an exact
partial quantity, creates a prepared container with optional manual carrier,
service, tracking, notes, and package-count facts, marks the container
shipped, then records immutable per-Order shipment handoffs and attaches them.
Pickup remains separate and has no carrier data.

The browser prevents obvious invalid quantities, while the server remains
authoritative for physical availability, remaining quantities, customer and
destination compatibility, open-order status, duplicate attachment, and RBAC.

## Combined shipments and history

A shipped container can attach compatible shipment handoffs from multiple
Orders. Each allocation remains on its source Order/line. History now projects
shipment ID, state, actors/timestamps, manual carrier/service/tracking, notes,
and package count beside the immutable handoff.

Existing per-handoff packing slips remain canonical and include shipment
metadata where captured. A single combined-container PDF is intentionally
deferred pending a designed multi-Order document renderer.

## Disposition

Trusted-host identity, CSRF, and `fulfillment.ship` protect the container
commands. Mark-shipped is idempotent; attachment is transactionally guarded.
Order closure remains lifecycle-owned.

Disposition: **DEPLOYABLE BUT NOT LIVE-VALIDATED**. Remaining P1 items are
the optional combined-shipment PDF and authenticated DEV floor validation.
