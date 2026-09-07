# M7.5F — Flatbed and Roll Production Stations

## Scope and authority

This milestone completes the operator-facing consumption of the canonical V2
`ProductionWork` and `ProductionAttempt` model. A station never creates a
second handoff, changes a frozen route, owns Artwork revisions, or advances
Fulfillment or Billing. The existing V2 station workspace remains the action
rail: start, output, and complete all call the Production application service.

## Flatbed and Roll behavior

Both stations receive only open Production work whose frozen route destination
matches the selected station. Work with no frozen station destination is not
placed in a queue and cannot be started. This removes the former “next up at
either station” ambiguity.

The shared station workspace provides an operator queue, selected-job detail,
canonical production-art entry point, Traveler link, material context,
attempt history, RBAC-gated start/output/complete actions, and paged search.
Flatbed retains the compact V1-style shared queue/detail/action composition,
including the frozen material context. Roll adds a station-specific
production-art view: it groups the frozen front and back
units of the same order line, labels Direct versus Prepress-origin work, and
keeps Artwork/Prepress as the only revision owner.

## Quantity and lifecycle integrity

`recordedGoodQuantity` includes active attempts; `remainingGoodQuantity` is
server-derived from it. The application service rejects a good-output delta
greater than the remaining required quantity. A satisfied unit cannot start a
new attempt. Completion records the actor/audit event through existing
Production mutation handling and invokes the existing Order lifecycle
recomputation; it does not close an Order, fulfill a shipment, or alter
financial state.

Partial output is therefore resumable through an active attempt and final
unit satisfaction occurs only at the required quantity. Fulfillment remains
intentionally independent and is the next bounded M7.5G responsibility.

## Material, artwork, and access

Material facts are read from the existing frozen Production material projection
and support the existing station material controls; no inventory-consumption
or scheduling/batch entity was introduced. Production artwork remains the
frozen assignment/file reference. Operators can open the canonical Artwork
workflow and Traveler but cannot replace station artwork.

The existing V2 capabilities continue to protect view/work/complete actions,
and existing operation requests plus audit events capture actor, organization,
work, attempt, state transition, and output changes.

## Validation and disposition

Static V2 and UI type checks, focused production contracts, station
presentation tests, fulfillment-production integrity tests, import-boundary
checking, and diff whitespace checking are required for this commit. No
production, provider, or MAIN mutation is part of this milestone.

Disposition: **DEPLOYABLE BUT NOT LIVE-VALIDATED**. A focused authenticated
DEV floor workflow remains required before production cutover. M7.5G should
cover partial/multiple fulfillment events, combined shipments, pickup versus
shipping, tracking, packing slips, and carrier plumbing.
