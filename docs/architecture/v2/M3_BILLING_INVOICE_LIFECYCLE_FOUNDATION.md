# M3 Billing / Invoice Lifecycle Foundation

## Existing M1 foundation and ownership

M1 established exactly one Billing-owned Invoice for every V2 Sales Order. It begins as `draft`; Sales supplies a scoped commercial projection and calls the named Billing draft synchronization port inside the same PostgreSQL transaction. Sales never writes Billing rows or calculates Invoice totals, while Billing never writes Sales rows. This slice retains that record and transitions that same canonical Invoice to `issued`; it never creates a second financial-document universe.

Billing owns Invoice lifecycle, lines, integer-cent subtotal/tax/total, the immutable issued snapshot, lifecycle attribution, and future payment allocation relationships. Sales retains only current Order commercial intent while the Invoice is Draft. Fulfillment retains customer-handoff facts and has no automatic `fulfilled -> issued` policy.

## Lifecycle, issuance, and locking

The implemented state machine is `draft -> issued`. `void` is represented by the existing M1 schema but deliberately has no canonical operation in this slice: payments have not yet established the payment-aware void policy, so direct draft-to-void and changes to issued/void facts fail closed at the database boundary.

`billing.invoice.issue.v1` requires `invoice.issue`, matching M0 business-request identity, fresh scoped Principal, and a Billing transaction. It takes the Sales Order header lock before the Invoice row lock, matching the Sales-edit then Billing-sync lock order. It then verifies the Order is open, the Draft's Sales state token equals the locked Order revision, all Invoice lines exist, currency is consistent, and integer-cent line subtotal plus tax equals the persisted total. Therefore a Sales commercial mutation wins and synchronizes the Draft before issuance, or issuance wins and subsequent Sales sync rolls back; a hybrid Order/issued-Invoice result cannot commit.

Invoice business identity remains the pre-existing canonical `InvoiceId`. M1 did not establish a permanent human invoice number and this slice does not invent one; retries cannot consume a new number because issuance allocates no number.

## Immutable financial/customer history

Migration 0206 adds one immutable `v2_billing_invoice_checkpoints` row per issued Invoice and issued-principal fields on the existing Invoice. The checkpoint freezes the Billing-owned lines, exact money/tax evidence, purchase order/terms, customer presentation identity including bill-to details where available, issuance timestamp, and truthful Principal attribution. It is fingerprinted from canonical JSON. PostgreSQL triggers reject issued/void Invoice mutation, issued/void line mutation, and checkpoint update/delete. Draft synchronization remains permitted only while the Invoice remains Draft.

## M0, Audit, outbox, and rollback

Issuance reserves the existing organization/operation/business-request identity, replays the original canonical result for an identical request, records principal attribution and shared `invoice_issued` Audit, writes the immutable checkpoint, enqueues exactly one `billing.invoice.issued.v1` durable outbox message, and completes the operation request in the same transaction. The outbox is a future seam for PDF rendering, communications, and accounting adapters only; no PDF, email, QuickBooks, provider identifier, payment, refund, or delivery status is introduced. Failure injection after state transition, checkpoint, outbox, and Audit proves rollback leaves no phantom issuance or idempotency residue.

## Deferred work

Post-issued corrections require a future explicit credit/rebill/adjustment operation; an issued Invoice is never reopened or silently resynchronized. Payments and Refunds will attach durable allocation facts without making Invoice state a payment ledger. Void, delivery, PDF rendering, QuickBooks/accounting synchronization, reconciliation/recovery workers, and Billing UI/API placement remain later bounded slices.

## Validation evidence

The M3 clone rehearsal proves exact draft issuance, snapshot preservation, idempotent replay, conflicting idempotency identity rejection, concurrent issuance, immutable persistence, authority and tenant isolation, truthful attribution/Audit/outbox, no Fulfillment mutation, and rollback at four transactional points. The retained M1 Order rehearsal proves Draft synchronization, Sales mutation concurrency, and non-Draft Sales rejection using the canonical issue operation.
