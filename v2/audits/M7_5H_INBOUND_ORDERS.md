# M7.5H V2-native inbound orders

**Status:** deployable source contract; not live-validated.

## V1 behavior retained and rejected

V1 is retained only as behavioral evidence: a bounded operator queue, durable
pre-order source evidence, an editable human-reviewed draft, explicit matching,
and idempotent conversion. V2 does not reuse V1's `inbound_order_*` tables,
legacy routes, Gmail mailbox credentials, AI/parser authority, client UI, or
direct legacy Order writes. Its old state model is not a V2 state authority.

## V2 intake model

Each V2 intake is a tenant-scoped durable record with a stable source provider
and provider message identifier, immutable source message fields, attachment
evidence, an operator-owned draft, matching decisions, transitions, and a
conversion result. The launch states are `received`, `needs_review`, `ready`,
`converted`, `rejected`, `duplicate`, `failed`, and `action_required`.
Terminal choices retain source evidence and actor/time/reason; they do not
delete messages to clean the queue.

The V2 uniqueness constraint on organization, source provider, and source
message identifier makes repeated/manual retry ingestion return the original
intake. Conversion stores a stable canonical Sales request identifier before it
runs; repeated conversion resolves the same Order rather than creating another.

## Provider and attachment boundary

M7.5H does not read Gmail, send email, or alter provider configuration. The
current V2 Gmail integration is send-only, with no approved read/list/download
scope. Intake ingestion is an explicitly bounded service/manual contract that
preserves provider IDs and is ready for a later provider adapter. Enabling live
Gmail reading requires a dedicated read-scope, re-consent, attachment-download
design, and provider validation milestone.

Attachments are source/reference evidence by default. No inbound-specific file
store exists, and an attachment cannot silently become production artwork.
Canonical artwork adoption/assignment remains an explicit downstream V2 Artwork
workflow after the operator has made a line and role decision.

## Review, CRM, product and Order conversion

The workspace provides a paginated/filterable queue and a source-evidence /
reviewed-draft layout. Operators use bounded canonical Customer and
customer-scoped Contact lookup, then correct PO, due date, fulfillment intent
and proposed lines, mark duplicate/rejected with a reason, or retry an
actionable record. No email-domain match silently selects a customer.
Ambiguous customer, product, price, dimensions, configuration, and artwork
remain blocked until a human resolves them.

Conversion calls V2 Sales' `OrderApplicationService.create`, never direct Order
SQL. It consequently uses canonical CRM validation, active Product pricing,
frozen route creation, invoice projection and workflow policy. The incoming
message's stated price remains source evidence; only existing Sales pricing
authority can create a price override. An unmatched/custom request stays in
review instead of creating an inbound-only line or custom price.

## Authority and remaining validation

Viewing requires `inbound.view`; review and terminal state changes require
`inbound.review`; conversion additionally requires `order.create`. The
canonical Sales service performs Customer, Contact, Product, price, workflow,
and tenancy validation. The server derives the actor from the authenticated V2
principal and retains transitions/conversion evidence under the organization
key.

Remaining P1 work: authenticated DEV operator validation, a deliberately
authorized Gmail-read adapter/re-consent, and canonical artwork adoption from
intake evidence. No provider access, production mutation, or automatic order
creation was performed by this milestone.
