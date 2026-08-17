# M5.2 Legacy Commercial Visibility and Active-Record Cutover Classification

## Scope

M5.2 presents existing legacy Quotes, Orders, Invoices, and Payments beside V2-native commercial records without copying, transforming, or migrating legacy data. Every compatibility row carries an explicit `source` tag and source-local `recordId`; the client never infers a source from an identifier format.

Legacy commercial details are read-only. Dedicated legacy Quote and Order read routes are separate from V2 command routes, while V2 mutations continue to accept only V2 route identities. The Finance projections include legacy invoices and payments as tagged history; they do not make those rows actionable.

## Active legacy Order classification

Classification is calculated at read time from tenant-scoped legacy commercial, production, fulfillment, and balance facts. It does not write a flag back to the legacy schema.

| Classification | Conservative rule |
| --- | --- |
| `CLOSED_HISTORY` | canceled/closed state, or delivered with no balance due |
| `ACTIVE_REQUIRES_CUTOVER_STRATEGY` | production still open, in production/ready for shipment, or packed fulfillment |
| `ACTIVE_BUT_CAN_REMAIN_LEGACY` | new, open, unpaid, no open production work |
| `AMBIGUOUS` | any other combination; no automatic safety conclusion |

The classification is an assessment only. It does not change order state, move operational work, create V2 records, or authorize a workflow change.

## Safety boundary

- All compatibility queries predicate on `organization_id` and run in repeatable-read, read-only transactions.
- Lists fetch a bounded candidate page from each source, merge on the server, and use a cursor containing timestamp, source, and source-local id for deterministic continuation.
- Source display identity is `source + recordId`, so duplicate display numbers cannot collide in the UI.
- Legacy routes are GET-only. No legacy conversion, invoice issue, payment, refund, routing, production, fulfillment, or editing endpoint was added.
- The DEV clone is the validation target; MAIN is out of scope.

## Deferred

Active-record migration/cutover execution, Products, Contacts, Storage, and any MAIN deployment remain separate milestones.

## DEV clone assessment (2026-08-17)

The approved DEV clone contains 15 legacy Quotes, 108 legacy Orders, 41 legacy Invoices, and 3 legacy Payments. The complete legacy Order assessment is 5 `CLOSED_HISTORY`, 59 `ACTIVE_BUT_CAN_REMAIN_LEGACY`, 44 `ACTIVE_REQUIRES_CUTOVER_STRATEGY`, and 0 `AMBIGUOUS`.
