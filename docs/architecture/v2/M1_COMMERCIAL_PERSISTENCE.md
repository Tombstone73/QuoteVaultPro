# M1.6 Commercial Persistence Foundation

## Decision

M1.6 establishes the additive PostgreSQL foundation for the future Sales module. It deliberately exposes no Quote, Order, conversion, or Invoice application writer. M1.7 can implement a writable Quote without redesigning the database shape.

The schema is V2-owned and additive: it does not repurpose V1 `quotes`, `orders`, `invoices`, or their line tables. V1 remains evidence and a compatibility-read source, never the V2 ownership model.

## Ownership and shape

`v2_sales_documents` is the one shared current-state header for Quote and Order commercial facts: tenant, document kind/number, CRM references, PO, requested due date, currency, Sales terms/context, notes, revision, and timestamps. `terms_json` contains only the terms-code/forward-compatible terms; tax context, sales representative, and notes are authoritative scalar columns and are prohibited in that JSON. It intentionally does not store header totals or tax totals: line totals are the current Sales commercial truth and Billing owns Invoice math.

`v2_sales_quote_details` and `v2_sales_order_details` are mutually typed lifecycle subtypes. Deferred reciprocal checks prevent a header from committing without, or later losing, its required subtype. Quote has expiration/delivery/acceptance facts; Order has only commercial open/cancelled facts. Route, production, fulfillment, shipping, and Invoice states are not smuggled into either lifecycle.

`v2_sales_document_lines` contains an ordered Product reference, description, quantity, integer-cent calculated/selling projections, and frozen `ResolvedProductConfiguration`, `PricingResult`, and `SellingPriceDecision` JSON evidence. The latter two remain distinct. Sales line evidence is not a mutable Product/PBV2 clone and it does not contain stock, routing, Artwork, or Billing rows.

Current CRM/Product IDs are tenant-scoped compatibility references. Compound FKs prevent a foreign-tenant customer, contact, product, or V2 Sales row from being referenced. When both a customer and contact are named, a Sales write trigger requires their active `customer_contact_links` association; contact-only and customer-only references remain valid. M1.3 read ports remain responsible for other lifecycle validation. Historical presentation identity belongs only in a checkpoint payload.

## Numbers, revisions, and idempotency

Durable internal ID, business number, and M0 operation request are separate facts. `v2_sales_document_number_counters` is keyed by organization and document kind. The only allocation primitive is one PostgreSQL `INSERT … ON CONFLICT … DO UPDATE … RETURNING` statement; it never computes `MAX()+1`. Numbers are unique per tenant/kind, display formats are stored with the document, and gaps after a rolled-back or failed operation are acceptable.

The header `revision` is the optimistic current-state token. A future writer changes a document only with the expected revision in a transaction and records one semantic M0 Audit/attribution event. Normal edits do not create checkpoints. M0 `v2_operation_requests` remains the only business-request idempotency owner; Sales does not create a competing request table.

## History and conversion

`v2_sales_quote_checkpoints` is append-only evidence for `quote_sent`, `quote_accepted`, and `quote_converted`. A PostgreSQL trigger rejects every update and delete. The payload includes the schema version, compact recipient presentation identity, commercial state, pricing/selling evidence, and canonical evidence fingerprint; it has no persisted PDF binary by default.

`v2_sales_quote_conversions` is the sole Quote → Order relation. Tenant-scoped unique constraints protect one conversion per Quote, source checkpoint, Order, conversion checkpoint, and (when present) M0 operation request. A deferred validation trigger requires a sent/accepted source checkpoint and a converted checkpoint for the same Quote. Thus Quote survival, no-reprice lineage, and duplicate conversion protection are physical facts—not only future application conventions.

## Billing and cross-module transaction boundary

M1.6 adds no Billing table or Invoice writer. Later direct Order creation will coordinate, in one PostgreSQL transaction:

    Sales.createOrder
      -> Billing.createDraftInvoice
      -> M0 attribution/Audit + outbox
      -> commit

Sales will pass the typed draft synchronization projection through `BillingPort`; it will not insert or update invoice rows. Billing will own its own one-current-Draft invariant and the issued-invoice boundary.

## Physical validation

The guarded clone rehearsal applies the immutable migration stream then proves: M0 postconditions remain intact; Sales table/index/constraint/trigger catalog is complete; wrong subtype, foreign-tenant CRM/Product reference, duplicate line position, checkpoint mutation/deletion, and duplicate Quote conversion are rejected; calculated and selling cents remain separate; concurrent same-tenant allocation is unique/sequential; another tenant can reuse its own sequence; and a rolled-back Sales transaction leaves neither document nor counter side effects.

It uses only `TEST_DATABASE_URL` with the established explicit V2 clone opt-in. It never accesses a V1 or production database.

## M1.7 implementation constraints

M1.7 implements only the Quote vertical slice through Sales module operations. It must validate Customers/Product compatibility reads, Pricing evidence, AuthorityPolicy, optimistic revision, M0 operation request replay/conflict, meaningful attribution/Audit, and transactional persistence against this foundation. It must not add Order, Invoice, Route, or V1 business orchestration merely because the physical tables now exist.

## Deliberate deferrals

- Exact Quote editing/no-op notes semantics and line-note product behavior.
- Whether conversion may use an unsent Quote; current physical validation requires a sent or accepted source checkpoint.
- Billing Invoice schema, exactly-one current Draft invariant, tax adapter, issuance, payment, and correction semantics.
- Route template/instance persistence and all production behavior.
- Product/PBV2 publishing, Recipe/BOM, stock, and external integrations.

**Next milestone: M1.7 — Quote Vertical Slice.**
