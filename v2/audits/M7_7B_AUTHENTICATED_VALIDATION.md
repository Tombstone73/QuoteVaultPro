# M7.7B authenticated workflow validation

## Safety boundary

Authenticated DEV validation is GET-only after schema attestation. It uses an already-active QA session and rejects any same-origin non-GET request or provider host request. No seeding, conversion, proof response, production action, fulfillment allocation, inbound ingestion/review, AI conversation creation, Stripe checkout, Gmail operation, or QuickBooks action is allowed.

## Planned read-only coverage

- Orders and Product Catalog/Builder read projections;
- Proofing, Prepress, Flatbed/Roll, Traveler, and Fulfillment read routes;
- Inbound queue/detail read routes only;
- portal Orders, Quotes, Invoices, Proofs, Catalog and customer-safe shipment reads;
- AI conversation/pending-command read routes only.

No durable DEV fixture IDs cover every domain. Existing immutable QA records may be selected from a GET list; otherwise an empty-state/read-route pass is recorded rather than creating data.

## Execution status

Blocked pending DEV schema attestation. The pre-reconciliation authenticated Orders workboard returns HTTP 500 because its allocation-aware read requires a missing current physical surface. No conclusion about business workflow behavior is drawn from that schema failure.
