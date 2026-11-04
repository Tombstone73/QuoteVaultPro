# UPS label void — DEV

## Existing architecture and scope

Reuses `upsLabels.voidUpsLabel`, tenant-scoped encrypted UPS OAuth/account credentials,
UPS Shipping v2409, existing purchase/package/label records, and owner/admin middleware.
No new endpoint, migration, payment/refund operation, or shipment ownership model.
A shared `UpsLabelVoidControl` exposes confirmation from Shipment History and Shipment Detail.
History is loaded on demand, rather than one API request per history row on page load.

Official contract: [UPS Shipping OpenAPI](https://github.com/UPS-API/api-documentation/blob/main/Shipping.yaml).
DELETE `shipments/v2409/void/cancel/{shipmentidentificationnumber}` without a tracking query
requests cancellation of the entire UPS shipment. PackageLevelResults status 1 means
voided or already voided; 0 means not voided. Explicit package results must cover the
stored identities exactly. Mixed, missing or unexpected package results stay uncertain.
UPS determines eligibility; local SHIPPED is not proof of carrier acceptance/tender.

## Integrity and recovery

- Shipment-first locking serializes void initiation against dispatch/draft changes/reversal.
- Duplicate confirmed requests are idempotent. Pending/uncertain attempts cannot repeat DELETE.
- Thirty-second carrier deadline includes reading the response body. Malformed/oversized,
  transport-failed or ambiguous responses remain locked; browser requests are bounded too.
- Original labels, tracking, purchase evidence and commercial snapshots are retained.
  Normalized carrier responses are retained in purchase evidence and append-only fulfillment events.
- No shipped quantities, Order status, Invoice balances or customer payments change.
- Unknown/partial results block replacement, draft edits, dispatch and quantity reversal.
- No documented automatic void-status lookup was established. A missing tracking event is
  not evidence of cancellation. Staff must check every tracking number in the UPS account
  or with UPS support, then explicitly record all-package confirmation and the UPS reference.
  This uses existing EXTERNAL_CANCEL_REPORTED semantics; it never fabricates API acceptance.
- Crash-stuck VOID_REQUESTING can be reconciled only after two minutes; late completion uses
  compare-and-set and cannot overwrite a newer reconciliation.
- Confirmed draft cancellation unlocks the existing correction → fresh rate → replacement
  purchase path. Shipped fulfillment requires a separate authorized quantity correction/new
  draft if appropriate. A void alone never makes already-shipped quantities available again.
- Original GIF evidence remains downloadable through the authenticated canonical route,
  explicitly labelled not for shipping in the confirmation dialog.

## Focused validation

- Scoped TypeScript with 8192 MB heap: 10 changed/new TS/TSX roots, zero introduced diagnostics; one verified pre-existing diagnostic remains.
- 14 UPS response/accounting unit tests passed.
- 30 shared confirmation and Fulfillment Workspace frontend tests passed, including browser request timeout.
- 11 real disposable loopback PostgreSQL tests passed: route → real service → committed readback, duplicate
  and concurrent requests, package-specific outcomes, transport failure, tenant/permission and
  environment boundaries, original authenticated label retrieval, audit rollback, late-result
  protection, shipment/Order/paid Invoice preservation, draft lock/replacement identity reuse.
- PostgreSQL uses all canonical migrations; UPS credentials/provider calls are mocked.
- Replacement coverage proves existing canonical draft lock release and a distinct durable
  replacement purchase identity, not a live UPS replacement purchase.

## Remaining acceptance

No real UPS voids, live credentials/entitlements, carrier refunds/credits, deployed DEV/MAIN,
physical label tests, or local visual browser verification were performed. Operator testing
must confirm eligible UPS cancellation and replacement in the intended environment. Unknown
results require the explicit carrier verification workflow above; no automatic retries.
