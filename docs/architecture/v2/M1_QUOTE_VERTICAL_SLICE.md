# M1.7 Quote Vertical Slice

M1.7 is the first writable V2 commercial path. It is deliberately limited to
Quotes: create, scoped read, optimistic commercial edit, calculated pricing,
explicit selling decisions, semantic audit, and sent/accepted checkpoints.

## Boundary

The injected V2 HTTP route resolves a verified principal outside request data,
then calls the Sales application service. The service authorizes through the
final permission-set `AuthorityPolicy`, reserves the M0 operation request,
coordinates one PostgreSQL transaction, and records attribution and audit only
after a successful mutation. Sales calls the M1.3 CRM/Product compatibility
ports and the M1.2 `PricingPort`; it never reads PBV2 trees itself.

`quote.overridePrice` is a separate capability. A caller supplies only a
selling instruction (calculated, unit override, total override, or discount);
the service derives the `PricingResult` and `SellingPriceDecision`. An override
therefore cannot replace or erase calculated-price evidence.

## Persistence and history

M1.6 sales-document, line, quote-detail, checkpoint, and number tables are
the commercial persistence model. M1.7 adds the platform-owned
`v2_audit_events` table and registers `quote.overridePrice`. Line updates keep
their existing IDs; removed lines are deleted only within the owning document
and organization scope. All Quote reads and mutations include organization
scope.

Current Quote state is mutable and guarded by a revision. Normal edits write
one concise semantic audit event, not a document snapshot. `send` and `accept`
create immutable, JSON-stable checkpoints holding the commercial line/pricing
evidence and minimal CRM presentation identity. PDFs are not stored. A Quote
may still be edited after send; that never alters the earlier checkpoint.

M0 idempotency stores a JSON-safe representation of the Quote result and
rehydrates the exact bigint document-number type for replay. The operation
request, quote rows, attribution, audit event, checkpoint, and success result
commit together or roll back together.

## Explicit exclusions

There is no Quote-to-Order conversion, Order creation, Draft Invoice,
Billing, Route, Production, Inventory, asset/artwork, UI workspace, or V1
runtime reuse. The V2 startup host keeps Quote routes disabled until it
supplies a verified-principal provider and the real transaction/service
composition.

## Verification

`npm run v2:m1:quote` is a guarded disposable-clone rehearsal. It migrates the
V2 catalog and exercises final permission-set issuance, CRM/Product scoped
compatibility reads, V2 Pricing, M0 replay, forced rollback, stale edit,
immutable checkpoints, audit, override denial, and concurrent request/number
behavior. It accepts only the existing guarded `TEST_DATABASE_URL` contract.

## Next milestone

M1.8 is Quote application/runtime composition and characterization hardening
only if the reconstruction sequence approves it; this slice does not begin
Orders or Billing.
