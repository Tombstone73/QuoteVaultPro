# EPS hosted callback: confirmed transport, posting blocked

Status: partial integration only. No automatic payment result acceptance or
posting is enabled. This release is not certification or live EPS activation.

## Evidence inspected (2026-11-03)

- EPS support email dated 2026-10-29, message `1a1898a00a5e6bd7`, confirms
  `successurl`, `failureurl`, `responseurl` on `getptk`, and HTTP POST with JSON
  to the supplied response URL.
- The owner's 2026-11-03 request, message `1a1a302bbcd9f89a`, asks for actual
  approval/decline callback examples, authentication, independent verification,
  and delivery retry behavior.
- EPS's latest reply, message `1a1a3296abf9ad09`, says the additional information
  has been requested and a reply will follow when available.
- Vendor-supplied Enhanced Gateway API Documentation v1.02, sent in message
  `19e8a52ebf7d3662`, was inspected in full. Hosted flow is on PDF pages 12-14;
  transaction JSON on pages 16-17 is a synchronous token-sale response, not a
  documented callback. It does not establish callback schema, currency,
  callback authentication, authoritative transaction lookup or retry semantics.
  Its final documentation-site reference has no actual URL.

The confidential manual is not added to Git. A synchronous response's
`TransactionResult`, `TransactionID`, `ApprovedAmount`, `BusinessId`, etc. must
not be assumed to describe the callback contract. The outgoing `apikey` header
is not evidence that incoming notifications use that authentication mechanism.
A PTK, guessed signature header, IP address or browser return is not verification.

## Existing canonical implementation

- `epsGatewayClient.ts`: authenticated outgoing hosted PTK request, hosted URL,
  synchronous response normalization, existing test/live client selection.
- `paymentProvider.service.ts`: invoice/tenant validation, pending `payments`
  attempt, manual staff confirmation, unique provider transaction/idempotency
  indexes, transactional invoice rollup through
  `reconcileInvoicePaymentStateInTransaction`, and existing workflow/audit hooks.
- `paymentReceiptHistoryService.ts`: canonical standalone receipts and reliably
  linked grouped allocations; no grouping by guessed dates/amounts.
- Staff EPS hosted initiation/manual confirmation remain unchanged. Other EPS
  transaction modes remain disabled. Portal automatic EPS settlement remains
  blocked by its existing contract.

## Safe changes delivered

`buildHostedPtkRequest` can include the three support-confirmed URL fields.
Optional server environment inputs are `EPS_HOSTED_SUCCESS_URL`,
`EPS_HOSTED_FAILURE_URL` and `EPS_HOSTED_RESPONSE_URL`; no environment/settings
were changed. With no inputs, the existing outgoing request is unchanged.
Destinations must be HTTPS and cannot embed credentials or fragments. URLs are
not accepted from a browser request and do not authorize payment confirmation.

`POST /api/payments/eps/response` is mounted before the general JSON parser and
application request logging. It enforces HTTPS, JSON object syntax, 64 KiB body
limit and no compressed bodies. Errors are structured and never echo input.
GET/browser redirects return 405. Every otherwise valid POST returns
`503 EPS_CALLBACK_VERIFICATION_UNAVAILABLE`: no 2xx acknowledgment, acceptance,
state transition, lookup, callback-content persistence, or payment posting.
Only an opaque rejection reference and structural category are logged.

This is an intentionally closed boundary, not a verifier adapter stub that can
be switched on with a boolean, API key or guessed signature. No callback fields
are interpreted as authoritative. Real callback validation and canonical
posting must be implemented after the missing vendor contract is obtained.

## Documentation required before completion

1. Actual approved/declined/pending JSON, field casing/envelope, finality and
   capture semantics; transaction/notification/PTK/merchant identifiers.
2. Exact amount precision and currency semantics, including whether currency is
   present or fixed by an independently verified merchant account contract.
3. Signature/authentication specification, raw-body bytes, timestamp/replay
   window, secret provisioning and rotation; or a documented read-only EPS
   transaction verification endpoint and its credentials/response semantics.
4. Retry schedule, duplicate event identity, out-of-order behavior, expected
   response statuses, redelivery/manual replay support and retention.
5. A verified unique merchant/account-to-tenant mapping and test/live boundaries.
   Callback-supplied tenant/payment IDs must never grant tenant authority.

## Remaining implementation after EPS responds

- Validate the documented callback/authentication, correlate to a durable existing
  attempt and immutable merchant/mode/amount/currency, and handle notifications
  arriving around attempt creation. Existing ticket IDs identify invoices, not
  necessarily unique attempts; do not guess attempt identity.
- Use canonical payment/receipt/allocation operations in one transaction,
  enforcing duplicate and stale/out-of-order protections. Manual confirmation
  must remain a separate authorized staff action; never route untrusted JSON
  through `recordHostedResult` as though it were manual evidence.
- Ensure the original receipt identity and accounting synchronization remain
  canonical. Preserve verified captures against later stale pending/decline
  notifications and reconcile uncertain outcomes authoritatively.
- Drive customer returns from authorized canonical payment status. A success or
  failure return URL does not establish that status. Show pending until actual
  verified persistence; never use query flags as payment confirmation.
- Test genuine verified approvals/declines/pending, concurrent duplicate posting,
  allocation, accounting readback and forced transactional rollback on isolated
  PostgreSQL before enabling automatic acceptance.

## Validation boundaries and activation

Focused HTTP/client tests cover the closed boundary and unchanged hosted/manual
routes. Isolated PostgreSQL tests snapshot actual payment, invoice, receipt and
financial audit rows across two tenants before and after untrusted claims,
retries, mismatches, malformed requests and browser returns. They prove no
financial mutation, not successful EPS verification, approval or rollback.

Do not set the response URL on live EPS traffic yet: this endpoint deliberately
rejects every notification and EPS redelivery behavior is unknown. No payment
credentials, settings, live transactions, workers or external services were
activated. No real invoice/customer records were used. Deployment and live EPS
verification are outstanding and require the completed vendor contract,
sandbox/certification evidence, reviewed environment URLs and separate activation.
