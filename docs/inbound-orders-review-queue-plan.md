# Inbound Orders Review Queue Plan

Status: architecture and planning only  
Date: 2026-05-06  
Scope: proposed TitanOS subsystem, no implementation committed

## Purpose

Inbound Orders Review Queue is a proposed centralized intake and review subsystem for external and automated order sources before they become permanent TitanOS quotes or orders.

The subsystem should eventually support:

- Email parser intake
- External customer API integrations
- Manual imports
- Customer portal submissions
- n8n, Zapier, webhook, and EDI-style automation

The core design principle is:

> Every inbound record should be reviewed as a side-by-side comparison between what came in and what TitanOS is about to create.

This plan intentionally does not define production migrations, routes, React pages, or implementation code. It is an architecture and UX planning document.

## OrderPilot Reference

OrderPilot is a useful reference for the operator workflow and UI concept. It was built to take already-parsed emails, stage them for review, then prepare them for screen automation entry into InfoFloPrint.

For TitanOS, the valuable part is the UX pattern, not the backend implementation.

OrderPilot's reusable concept:

```text
Pending Orders | Source Email | Editable Order Form
```

TitanOS should adapt that into:

```text
Inbound Queue | Source Evidence | TitanOS Draft Builder
```

Recommended pieces to preserve conceptually:

- Resizable multi-panel review workspace.
- Fast-scan queue cards with confidence, flags, file count, line item count, sender/customer preview, PO/reference, and received time.
- Source evidence visible while editing extracted fields.
- Editable normalized order/quote form.
- Customer matching/autocomplete.
- Line item correction before approval.
- Attachment review in the same workspace.
- Anchored actions for save, reject, approve, and submit.
- Confidence scores used for triage and warnings, not as automatic truth.
- Later approved/export/automation queue after human review.

Pieces not to carry forward directly:

- Local-only filesystem open actions as a production web behavior.
- SQLite/FastAPI staging schema as the TitanOS data model.
- InfoFlo screen automation as the approval target.
- `eval`-based display customization.
- Flet-specific UI code.
- Filesystem package creation as the permanent record.

TitanOS should use the same operator mental model with a TitanOS-native backend: Express, Drizzle, PostgreSQL, tenant context, audit logs, canonical file records, PBV2 pricing, proof/prepress routing, and existing quote/order workflows.

## Architecture Overview

Inbound Orders Review Queue should sit upstream of the existing TitanOS quote/order lifecycle.

```text
External Source
  -> Raw Intake Record
  -> Parsed Draft Payload
  -> Review Queue
  -> Human Validation / Matching / Cleanup
  -> Permanent TitanOS Quote or Order
  -> Existing TitanOS workflows
```

The queue should not create permanent quotes or orders during intake. Intake creates isolated temporary records containing:

- Raw source payload
- Normalized payload
- Extracted customer/order/line item data
- Source metadata
- Attached files
- Warnings
- Confidence scores
- Duplicate/idempotency markers
- Event history

Only an explicit approval/submission action should create canonical TitanOS data.

## TEMP To PERMANENT Lifecycle

TitanOS already has TEMP to PERMANENT behavior around quote line items, especially staged quote line items, `isTemporary`, file attachment staging, and quote/order snapshot preservation.

This subsystem should follow the same philosophy at the inbound order level.

Lifecycle:

```text
TEMP
  inbound_order_records
  inbound_order_line_items
  inbound_order_files
  inbound_order_warnings
  inbound_order_events

REVIEWED TEMP
  customer/product/files validated
  warnings resolved or acknowledged
  ready for approval

PERMANENT
  quotes/orders
  quote_line_items/order_line_items
  quote/order attachments
  audit logs
  workflow state

LINKED
  inbound record stores createdQuoteId or createdOrderId
```

Raw inbound payloads should remain immutable after intake, even if the normalized draft is edited. Human edits should be tracked as review changes/events.

## Safe Integration With Existing TitanOS Workflows

The subsystem must be additive and upstream-only.

It should not mutate:

- Existing quote/order workflows
- Proofing behavior
- Production routing
- Fulfillment
- Invoices/payments
- QuickBooks sync

Permanent creation should happen through a transactional service that reuses existing TitanOS creation rules wherever possible.

Approval/submission must preserve:

- Tenant isolation
- Quote/order numbering rules
- Customer/contact snapshots
- PBV2 pricing snapshots
- Product option selections
- File record and attachment conventions
- Design/proof/prepress routing intent
- Production defaults
- Audit/event philosophy

Recommendation: Phase 1 should create permanent quotes first, not direct orders. Direct inbound-to-order creation should be policy-gated and delayed until later phases.

## Data Model Proposal

Recommended tables:

```text
inbound_order_sources
inbound_order_records
inbound_order_line_items
inbound_order_files
inbound_order_warnings
inbound_order_decision_flags
inbound_order_events
inbound_order_review_snapshots
inbound_order_conversations
inbound_order_messages
inbound_order_reply_drafts
inbound_order_parse_attempts
inbound_order_idempotency_keys
inbound_order_customer_matches
```

### inbound_order_sources

Tracks configured intake sources per organization.

Suggested fields:

- `id`
- `organizationId`
- `sourceType`: `email`, `customer_api`, `webhook`, `csv_import`, `portal`, `manual`, `n8n`, `zapier`, `edi`
- `name`
- `status`: `active`, `paused`, `disabled`
- `sourceTrustLevel`: `manual_internal`, `trusted_customer_api`, `trusted_portal`, `semi_trusted_email`, `untrusted_public`
- `authMode`: `none`, `api_key`, `hmac`, `oauth`, `system`
- `externalAccountId`
- `settingsJson`
- `createdByUserId`
- `createdAt`
- `updatedAt`

Suggested indexes:

- `(organizationId, sourceType)`
- `(organizationId, status)`
- `(organizationId, sourceTrustLevel)`
- Optional unique `(organizationId, sourceType, name)`

### Source Trust Levels

Source trust should be first-class because not all inbound records deserve the same automation permissions.

Recommended trust levels:

- `manual_internal`: Created by staff inside TitanOS. Highest operational trust, but still validates.
- `trusted_customer_api`: Known authenticated customer/system using API keys or HMAC.
- `trusted_portal`: Authenticated customer portal submission with known tenant/customer context.
- `semi_trusted_email`: Email from a mailbox/parser where sender identity may be inferred but not guaranteed.
- `untrusted_public`: Public webhook/form/unknown sender with high spam and abuse risk.

Trust level may later influence:

- Whether auto-approval is allowed.
- Whether AI-generated customer replies may auto-send.
- Whether direct order creation is allowed.
- Required human review thresholds.
- File type and file size restrictions.
- Rate limits.
- Spam thresholds.
- Duplicate strictness.
- Whether source can attach executable/archive files.
- Whether reminders can be automated.

Automation policy should always combine trust with validation outcomes:

```text
Auto-approve only when:
  source trust permits it
  no blocking warnings exist
  no human decision flags exist
  files are safe
  duplicate checks are clear
  submission preview passes
```

### inbound_order_records

Primary queue object.

Suggested fields:

- `id`
- `organizationId`
- `sourceId`
- `sourceType`
- `sourceLabel`
- `sourceTrustLevel`
- `status`
- `reviewOutcome`
- `requiresHumanDecision`
- `reviewRequiredReason`
- `externalReference`
- `idempotencyKey`
- `payloadHash`
- `rawPayloadJson`
- `normalizedPayloadJson`
- `extractedCustomerJson`
- `extractedOrderJson`
- `extractedShippingJson`
- `confidenceScore`
- `duplicateScore`
- `matchedCustomerId`
- `matchedContactId`
- `matchedQuoteId`
- `matchedOrderId`
- `createdQuoteId`
- `createdOrderId`
- `assignedToUserId`
- `submittedByUserId`
- `rejectedByUserId`
- `rejectionReason`
- `receivedAt`
- `parsedAt`
- `reviewStartedAt`
- `approvedAt`
- `submittedAt`
- `rejectedAt`
- `archivedAt`
- `createdAt`
- `updatedAt`

Recommended coarse status values:

```text
received
processing
needs_review
waiting_on_customer
ready
approved
submitted
failed
terminal
```

Status should stay coarse. Detailed operational state should be derived from warnings, blockers, human decision flags, file states, duplicate checks, parse attempts, events, and submission attempts.

Examples:

- `needs_review` plus open blocking warning `missing_customer` means "Needs customer match".
- `needs_review` plus decision flag `ambiguous_product_match` means "Needs product decision".
- `needs_review` plus file status `quarantined` means "Needs file review".
- `waiting_on_customer` plus latest message event `reminder_sent` means "Waiting, reminder sent".
- `failed` plus latest event `submission.failed` means "Submission failed".
- `terminal` plus `reviewOutcome = rejected` means "Rejected".
- `terminal` plus `reviewOutcome = spam` means "Spam".
- `terminal` plus `reviewOutcome = duplicate` means "Duplicate".
- `terminal` plus `archivedAt` means "Archived".

Tradeoffs:

- Coarse statuses reduce enum churn and keep workflow migrations simpler.
- Derived UI state is more flexible and can evolve without database status changes.
- Queries for specific queue slices may need helper views, summary columns, or service-level projection logic.
- The UI must be disciplined about using a central state projection helper instead of duplicating status interpretation in components.

Suggested indexes:

- `(organizationId, status, receivedAt desc)`
- `(organizationId, sourceType, receivedAt desc)`
- `(organizationId, assignedToUserId, status)`
- `(organizationId, matchedCustomerId)`
- `(organizationId, createdQuoteId)`
- `(organizationId, createdOrderId)`
- Unique `(organizationId, sourceId, idempotencyKey)` where `idempotencyKey` is not null
- `(organizationId, payloadHash)`
- `(organizationId, externalReference)`

### inbound_order_line_items

Temporary extracted line items before permanent quote/order creation.

Suggested fields:

- `id`
- `organizationId`
- `inboundRecordId`
- `sortOrder`
- `status`: `extracted`, `needs_review`, `validated`, `excluded`
- `rawLineJson`
- `normalizedLineJson`
- `productId`
- `variantId`
- `productNameRaw`
- `description`
- `width`
- `height`
- `quantity`
- `optionSelectionsJson`
- `pbv2TreeVersionId`
- `pricingPreviewJson`
- `confidenceScore`
- `warningsJson`
- `reviewedByUserId`
- `createdQuoteLineItemId`
- `createdOrderLineItemId`
- `createdAt`
- `updatedAt`

Suggested indexes:

- `(organizationId, inboundRecordId, sortOrder)`
- `(organizationId, productId)`
- `(organizationId, status)`

### inbound_order_files

Links source files, artwork, purchase orders, references, and payload artifacts to inbound records.

Suggested fields:

- `id`
- `organizationId`
- `inboundRecordId`
- `inboundLineItemId`
- `fileRecordId`
- `sourceFilename`
- `role`: `artwork`, `po`, `reference`, `email_attachment`, `csv`, `source_payload`, `other`
- `mimeType`
- `sizeBytes`
- `checksum`
- `status`: `uploaded`, `scanning`, `available`, `quarantined`, `rejected`, `linked`
- `reviewNotes`
- `createdQuoteAttachmentId`
- `createdOrderAttachmentId`
- `createdAt`
- `updatedAt`

Use TitanOS canonical `file_records`, `storage_placements`, and derivative strategy. Do not create a parallel storage system.

Suggested indexes:

- `(organizationId, inboundRecordId)`
- `(organizationId, inboundLineItemId)`
- `(organizationId, fileRecordId)`
- `(organizationId, status)`
- `(organizationId, checksum)`

### inbound_order_warnings

Normalized review issues.

Suggested fields:

- `id`
- `organizationId`
- `inboundRecordId`
- `inboundLineItemId`
- `severity`: `info`, `warning`, `blocking`
- `code`
- `message`
- `fieldPath`
- `status`: `open`, `resolved`, `ignored`
- `resolutionNote`
- `resolvedByUserId`
- `createdAt`
- `resolvedAt`

Common warning codes:

```text
missing_customer
ambiguous_customer_match
missing_product
ambiguous_product_match
missing_dimensions
invalid_quantity
pricing_failed
duplicate_possible
file_type_blocked
file_scan_pending
po_number_duplicate
low_confidence_parse
unsupported_option
address_incomplete
```

Suggested indexes:

- `(organizationId, inboundRecordId, status)`
- `(organizationId, severity, status)`
- `(organizationId, code)`

### inbound_order_decision_flags

Decision flags are separate from warnings. They represent ambiguous business decisions that require human judgment even when the data is structurally valid.

Examples:

- Customer match confidence is uncertain.
- Product match confidence is uncertain.
- AI inferred substrate/material.
- AI inferred single-sided vs double-sided.
- Possible duplicate order.
- Ambiguous finishing options.
- Artwork intent is unclear.
- Customer terminology maps to multiple TitanOS products/options.

Suggested fields:

- `id`
- `organizationId`
- `inboundRecordId`
- `inboundLineItemId`
- `flagType`
- `fieldPath`
- `summary`
- `suggestedValueJson`
- `candidateValuesJson`
- `confidenceScore`
- `status`: `open`, `accepted`, `overridden`, `dismissed`
- `decisionValueJson`
- `decisionNote`
- `decidedByUserId`
- `createdAt`
- `decidedAt`

Suggested flag types:

```text
ambiguous_customer_match
ambiguous_product_match
ambiguous_material
ambiguous_sidedness
ambiguous_finishing
possible_duplicate
ai_inferred_value
missing_but_inferable
customer_specific_term
```

Suggested indexes:

- `(organizationId, inboundRecordId, status)`
- `(organizationId, flagType, status)`
- `(organizationId, confidenceScore)`

Decision flags differ from warnings:

- Validation errors mean the record cannot be submitted because required data is invalid or missing.
- Blocking warnings mean a known rule prevents approval until corrected or explicitly waived.
- Informational notices provide context but do not require action.
- Decision flags mean TitanOS has a plausible value, but the business meaning is ambiguous and a human must choose or confirm.

Future automation policy should be able to express:

```text
Auto-approve only if no open decision flags exist.
```

At the record level, `requiresHumanDecision` and `reviewRequiredReason` can be denormalized summary fields derived from open decision flags.

### inbound_order_review_snapshots

Raw source payloads should be immutable, but reviewed state also needs immutable preservation.

When a reviewer approves or submits, TitanOS should preserve:

- Reviewed normalized payload.
- Reviewed customer/contact match.
- Reviewed line items.
- Reviewed option selections.
- Reviewed product/material mappings.
- Reviewed file associations.
- Warning state at approval/submission time.
- Decision flag state at approval/submission time.
- Reviewer edits and decision notes.
- Submission preview payload.

Reason: future parser changes, product catalog changes, customer updates, or pricing changes must not rewrite the historical review state that led to a quote/order.

Suggested fields:

- `id`
- `organizationId`
- `inboundRecordId`
- `snapshotType`: `approval`, `submission`, `rejection`, `customer_reply`
- `snapshotVersion`
- `payloadJson`
- `createdByUserId`
- `createdAt`

Suggested indexes:

- `(organizationId, inboundRecordId, createdAt)`
- `(organizationId, snapshotType, createdAt)`

Store snapshots as JSON documents assembled by the service layer. They should be immutable append-only records. If a record is approved, then edited again before submission, a new snapshot should be created rather than mutating the prior one.

### inbound_order_events

Subsystem-specific event stream.

Suggested fields:

- `id`
- `organizationId`
- `inboundRecordId`
- `actorUserId`
- `actorType`: `user`, `system`, `source`, `automation`
- `eventType`
- `fromStatus`
- `toStatus`
- `message`
- `metadataJson`
- `createdAt`

Example event types:

```text
record.received
parse.started
parse.completed
parse.failed
customer.match.suggested
customer.match.confirmed
line_item.edited
warning.resolved
file.quarantined
approval.requested
record.approved
submission.started
quote.created
order.created
customer_reply.draft_created
customer_reply.sent
customer_reply.received
reminder.sent
record.waiting_on_customer
record.reopened
record.rejected
record.archived
```

Suggested indexes:

- `(organizationId, inboundRecordId, createdAt)`
- `(organizationId, eventType, createdAt)`

High-value staff actions should also be mirrored to existing `audit_logs` with `entityType = inbound_order_record`.

### inbound_order_conversations

Inbound orders may evolve across multiple emails, portal messages, API updates, and file drops. Email intake especially needs conversation threading.

Suggested fields:

- `id`
- `organizationId`
- `sourceId`
- `threadKey`
- `subjectNormalized`
- `customerId`
- `contactId`
- `status`: `open`, `waiting_on_customer`, `resolved`, `abandoned`
- `createdAt`
- `updatedAt`

Thread keys can come from:

- Email `Message-ID`, `In-Reply-To`, and `References` headers.
- Normalized subject and sender fallback.
- Portal conversation ID.
- API-provided conversation/reference ID.
- Manual staff link.

### inbound_order_messages

Stores individual source/customer/staff messages linked to a conversation and optionally to an inbound record.

Suggested fields:

- `id`
- `organizationId`
- `conversationId`
- `inboundRecordId`
- `direction`: `inbound`, `outbound`, `internal`
- `sourceType`
- `externalMessageId`
- `fromAddress`
- `toAddressesJson`
- `subject`
- `bodyText`
- `bodyHtmlFileRecordId`
- `rawPayloadFileRecordId`
- `receivedAt`
- `sentAt`
- `createdAt`

Messages should allow:

- Reply association.
- Attachment accumulation.
- Clarification loops.
- Linking a later customer reply back to the original inbound record.
- Creating a new inbound record from a later message when it is a materially separate request.

### inbound_order_reply_drafts

Stores AI- or staff-generated customer clarification drafts.

Suggested fields:

- `id`
- `organizationId`
- `inboundRecordId`
- `conversationId`
- `draftType`: `clarification_request`, `reminder`, `status_update`
- `status`: `draft`, `approved_to_send`, `sent`, `discarded`
- `subject`
- `body`
- `missingFieldsJson`
- `aiMetadataJson`
- `createdByUserId`
- `approvedByUserId`
- `sentByUserId`
- `createdAt`
- `approvedAt`
- `sentAt`

Draft replies should be linked to events and review snapshots. Initial behavior should require human approval before sending.

## Idempotency And Duplicate Detection

Use layered idempotency.

Exact idempotency signals:

- Source-provided idempotency key
- External source message ID
- Webhook event ID
- Email provider message ID
- Payload hash

Business duplicate signals:

- Customer/contact
- PO number
- Sender email
- Requested due date
- Similar line item hashes
- Similar total
- Similar attachment checksums

Recommended behavior:

- Exact idempotency collision should not create a second active inbound record.
- Payload duplicate should create a duplicate warning or mark as duplicate depending on source policy.
- Fuzzy/business duplicate should be advisory and visible in the review UI.
- Duplicate warnings must be acknowledged before approval.

## Workflow Design

Primary path using coarse statuses:

```text
received
  -> processing
  -> needs_review
  -> ready
  -> approved
  -> submitted
```

Failure and alternate paths:

```text
processing -> failed -> needs_review or terminal
needs_review -> rejected
needs_review -> waiting_on_customer
waiting_on_customer -> needs_review
waiting_on_customer -> terminal
ready -> rejected
approved -> failed -> ready or terminal
any non-terminal -> terminal
```

Detailed labels such as "Needs customer match", "Needs product decision", "File quarantined", "Possible duplicate", or "Waiting, reminder sent" should be derived from:

- Open validation blockers.
- Open warnings.
- Open decision flags.
- File status.
- Duplicate check state.
- Latest conversation/message events.
- Latest parse/submission event.

### Intake

Responsibilities:

- Validate source identity.
- Resolve tenant from source credentials or authenticated user context.
- Store raw payload before parsing.
- Compute idempotency key and payload hash.
- Attach files through canonical file storage.
- Create `record.received` event.
- Queue parse attempt.
- Create or attach to an inbound conversation when source data includes thread identifiers.

### Parsing

Responsibilities:

- Normalize source payload into a shared inbound draft format.
- Extract customer, order, shipping, line items, and files.
- Generate confidence scores.
- Generate warnings.
- Store parse metadata.

Parsing must never create permanent quotes or orders.

### Review

Reviewer must be able to see:

- Source summary
- Original source payload
- Customer match candidates
- Editable customer/order fields
- Editable line items
- File/artwork preview
- Duplicate candidates
- Warnings
- Confidence score
- Event history

Blocking warnings should prevent approval.

Open human decision flags should prevent automation. Depending on organization policy, they may also block manual approval until accepted, overridden, or dismissed.

### Validation

Validation should check:

- Tenant-scoped customer/contact exists or explicit new-customer creation is allowed.
- Products and variants exist and are active.
- Dimensions and quantity are valid.
- PBV2 pricing preview succeeds.
- Required files are present or intentionally waived.
- File scan status is safe.
- Exact idempotency collision does not exist.
- Duplicate warnings are resolved or acknowledged.
- No unresolved decision flags remain when policy requires a human decision.

### Matching

Customer matching signals:

- Email address
- Domain
- Contact name
- Company name
- Phone
- Billing/shipping address
- External customer ID
- Prior order history

Product matching signals:

- SKU
- Product name alias
- External catalog mapping
- Option labels
- Dimensions
- Material hints

Product matching should be treated as a likely future subsystem, not a one-off parser feature.

Recommended product matching architecture:

- Product alias mappings: tenant-scoped aliases that map external names to TitanOS products.
- SKU matching: exact SKU/external SKU should outrank fuzzy name matches.
- Synonym dictionaries: substrate/material/finish terms such as "coroplast", "corrugated plastic", "yard sign material".
- Customer-specific terminology: some customers may use internal product names that differ from TitanOS catalog labels.
- Dimensional inference: parse dimensions from body, subject, filenames, or artwork metadata.
- Material inference: suggest substrate from text, product family, or historical customer behavior.
- Option inference: map source text to PBV2 selections such as sidedness, lamination, grommets, hems, mounting, rush, or proof requirements.
- Reusable mapping dictionaries: org-level and customer-level dictionaries should be editable over time.
- Option-level confidence: product may be high confidence while finish or sidedness remains ambiguous.
- AI-assisted suggestions: AI can suggest mappings but should not be authoritative without deterministic validation or human approval.

Suggested confidence levels:

- Record-level confidence: overall parse confidence.
- Customer confidence: customer/contact match.
- Product confidence: selected product/variant.
- Option confidence: each inferred option selection.
- Material confidence: substrate/material match.
- Dimension confidence: parsed size/quantity.

Ambiguous product/option/material matches should create decision flags rather than only warnings.

### Approval

Approval means the reviewed inbound draft is ready to become a permanent TitanOS quote or order.

Approval should:

- Lock reviewed payload version.
- Re-run validation.
- Confirm no open required human decision flags.
- Create an approval review snapshot.
- Write approval event.
- Move record to `approved`.

### Submission Preview

Before submission, the reviewer should see a clear preview of what TitanOS is about to create.

The preview should include:

- Target type: quote or order.
- Customer and contact.
- Billing/shipping snapshot summary.
- PO/reference and due date.
- Line item count.
- Product/variant/option summary.
- Estimated totals and pricing status.
- Routing/proofing/prepress expectations.
- File/artwork counts and roles.
- Open warnings, acknowledged warnings, and resolved warnings.
- Open or resolved decision flags.
- Duplicate indicators.
- Source trust level and automation policy result.

The submission preview should be generated server-side from the same service that will submit the record. This reduces drift between "what the UI showed" and "what TitanOS created".

Submission preview payloads should be captured in `inbound_order_review_snapshots` at approval/submission time.

### Submission

Submission should run in one transaction.

Responsibilities:

- Re-check the inbound record is approved and not already submitted.
- Lock the inbound record row.
- Re-generate or validate the submission preview.
- Create quote or order using TitanOS-native services/rules.
- Create line items using existing pricing and PBV2 snapshots.
- Link inbound files to quote/order attachments.
- Write audit logs.
- Store `createdQuoteId` or `createdOrderId`.
- Move to `submitted`.

Recommendation: Phase 1 should submit to a quote by default. Direct order creation can be added later behind organization/source policy.

### Waiting On Customer

Some inbound records cannot be completed without customer clarification.

Examples:

- Missing substrate/material.
- Missing size.
- Missing quantity.
- Missing single-sided vs double-sided.
- Missing finishing details.
- Unclear artwork intent.
- Contradictory instructions.

Recommended handling:

```text
needs_review -> waiting_on_customer
waiting_on_customer -> needs_review
waiting_on_customer -> terminal
terminal -> needs_review
```

Operational states derived from events:

- `waiting_on_customer`: clarification request sent or manually marked waiting.
- `clarification_received`: inbound reply/message linked to the conversation.
- `reminder_sent`: reminder sent while still waiting.
- `abandoned`: terminal outcome after timeout/no response.
- `reopened`: previously terminal/waiting record brought back into review.

When a clarification arrives:

- Link the message to the existing conversation.
- Attach new files to the same inbound record or conversation.
- Create `customer_reply.received` event.
- Re-open the record to `needs_review`.
- Surface changed/new information in the source evidence panel.
- Preserve prior review state and message history.

### AI Missing Information Reply Assistant

Future behavior should support AI-generated customer follow-up draft replies when required information is missing.

Initial behavior:

- AI generates suggested draft replies only.
- Human review is required.
- No auto-send initially.
- Draft is linked to the inbound record and conversation.
- Outbound reply history is stored.
- Record may move to `waiting_on_customer`.

AI draft reply examples:

- Ask for missing substrate.
- Ask for missing size.
- Ask for quantity.
- Ask whether artwork is single- or double-sided.
- Ask for finishing details.
- Ask for clearer artwork instructions.

Future behavior:

- Trusted-source/customer auto-send policies.
- Automated reminder follow-ups.
- AI-generated clarification summaries.
- Source/customer-specific tone templates.

Schema implications:

- Store reply drafts in `inbound_order_reply_drafts`.
- Store outbound messages in `inbound_order_messages`.
- Store AI metadata, prompt/template version, and missing fields.
- Add events for draft creation, approval, sending, and replies.

Operational implications:

- Staff need a review/edit/send surface.
- Sent replies should be visible in the source evidence/conversation panel.
- Replies should update waiting state and due/reminder timestamps.
- Auto-send must be disabled until source trust and review policies are mature.

### Rejection

Rejection should preserve raw data for audit but prevent submission.

Suggested rejection categories:

- `spam`
- `duplicate`
- `invalid_request`
- `not_an_order`
- `unsupported`
- `customer_canceled`

### Archival

Archival should hide old terminal records from active queues without immediately deleting source data. Retention policy can be added later.

## UI And UX Plan

The future UI should be an OrderPilot-inspired review cockpit:

```text
Inbound Queue | Source Evidence | TitanOS Draft Builder
```

### Navigation

Place under the Sales navigation near Quotes and Orders.

Suggested routes:

- `/inbound-orders`
- `/inbound-orders/:id`

Suggested nav label: `Inbound`

### Queue List

The queue should support both card and dense table layouts over time. Phase 1 can start with a card/list rail inside the review workspace.

Queue item fields:

- Status
- Source type
- Received time
- Customer guess
- Sender/email
- PO/reference
- Line item count
- File count
- Warning count
- Confidence score
- Duplicate indicator
- Assigned reviewer
- Target type: quote/order
- Result link after submission

Default tabs:

```text
Needs Review
Ready
Failed
Submitted
Rejected
All
```

Filters:

- Status
- Source type
- Assigned to me
- Warning severity
- Confidence range
- Customer matched/unmatched
- Has files
- Duplicate possible
- Date range
- Search by customer, email, PO, external reference, and source text

### Source Evidence Panel

This replaces OrderPilot's email viewer with a source-agnostic evidence panel.

Tabs:

- Rendered email or source summary
- Plain text body
- Attachments/files
- Raw payload
- Normalized payload
- Parse attempts
- Headers/source metadata
- Conversation history
- Customer clarification drafts and replies

For email:

- Subject
- From
- To/CC when useful
- Received date
- Message ID
- Body
- HTML preview, sanitized or sandboxed
- Attachments
- Threaded replies and follow-ups

For API/webhook:

- Source name
- External reference
- Request metadata
- Raw JSON
- Signature/idempotency metadata
- Files

For CSV/manual import:

- Source filename
- Row/group information
- Original CSV artifact
- Parsed row data

### Conversation And Clarification Panel

Inbound review should support records that evolve over multiple messages.

The UI should show:

- Original inbound message.
- Later replies.
- Staff outbound clarification requests.
- Reminder history.
- Newly received files.
- Message-level timestamps and participants.
- Which message introduced or changed each important field when known.

For waiting records, the conversation panel should make it obvious:

- What information is missing.
- What was last asked.
- When the last message was sent.
- Whether a reminder is due.
- Whether new clarification has arrived.

### TitanOS Draft Builder

This replaces OrderPilot's editable order form.

Sections:

- Target type: create quote, create order later
- Customer/contact match
- Billing/shipping snapshot preview
- PO/reference/due date
- Flags and notes
- Line items
- Files/artwork associations
- Pricing preview
- Warnings and validation
- Approval/submission actions

The builder should feel like a focused intake version of the existing quote/order editor, not a separate product system.

### Warning System

Warnings should be visible and actionable.

Groups:

- Blocking
- Needs attention
- Informational

Each warning should include:

- Severity
- Message
- Field target
- Suggested fix
- Resolve or ignore action
- Resolution note when ignored

Blocking warnings prevent approval.

### Human Decision Flags

Decision flags should appear beside warnings but be visually distinct.

Recommended UI treatment:

- Warnings say "this may be wrong or invalid".
- Decision flags say "choose or confirm the business meaning".
- Decision flags should show candidate values when available.
- Accepted AI-inferred values should record who accepted them.
- Overrides should require a short decision note for high-impact fields.

Examples:

- "AI inferred material: 4mm coroplast. Confirm?"
- "Possible duplicate: similar PO from same customer yesterday."
- "Product could be Banner or Mesh Banner."
- "Finishing may mean grommets or hems."

Automation readiness should clearly show:

```text
Auto-approval blocked: 2 human decisions required
```

### Customer Matching UI

Customer matching should be explicit for uncertain records.

Display:

- Extracted customer data
- Suggested matches
- Confidence score
- Match reasons
- Existing customer search
- Contact search
- Create-new-customer action if allowed
- Address comparison

Avoid automatic customer creation for low-confidence sources.

### Line Item Editing UX

Line items should support:

- Product selector
- Variant selector
- Width, height, quantity
- Option mapping
- Pricing preview
- File/artwork association
- Notes
- Exclude from submission
- Per-line warnings

Routing preview can be shown, but production routing should remain derived from TitanOS rules.

### Artwork And File Preview

Use existing TitanOS attachment/file preview patterns.

Support:

- Thumbnail grid
- PDF/image preview
- File metadata
- Role assignment: artwork, PO, reference, other
- Link file to line item
- File scan/quarantine state
- Large file indicator
- Transfer link indicator

### Actions

Primary actions:

- Save review changes
- Approve
- Submit to quote
- Reject
- Archive
- Ask customer
- Create reply draft
- Mark waiting on customer
- Reopen after clarification

Later actions:

- Submit to order
- Retry parse
- Mark duplicate
- Mark spam
- Assign reviewer
- Batch approve for trusted records

### Submission Preview UX

Before creating a permanent quote/order, show a confirmation preview generated by the backend.

The preview should be readable without opening every section:

- Quote/order target.
- Customer/contact.
- PO/reference/due date.
- Line items and totals.
- Files and artwork associations.
- Routing/proof/prepress expectations.
- Open/resolved warnings.
- Decision flags and decisions.
- Duplicate indicators.
- Source trust and automation policy result.

Submission should require explicit confirmation when:

- Any warning was ignored.
- Any decision flag was overridden.
- A duplicate candidate exists.
- Customer was newly created from inbound data.
- Product or material was AI-inferred.
- Source trust is `semi_trusted_email` or `untrusted_public`.

## Integration Planning

Use source adapters.

Conceptual adapter contract:

```text
InboundSourceAdapter
  receive()
  normalize()
  parse()
  computeIdempotency()
  attachFiles()
```

### Email Parser

- Source identity: connected mailbox/rule.
- Idempotency: provider message ID plus mailbox/source ID.
- Store raw headers/body.
- Store attachments as inbound files.
- Parse sender, customer, PO, due dates, line items, and artwork.
- Keep all email records in human review at first.

### Customer API

- Tenant-scoped API keys.
- Optional HMAC signing.
- Required idempotency key for production clients.
- JSON schema validation before persistence.
- External customer/product mapping can be added later.

### n8n, Zapier, And Webhooks

- Treat as webhook source.
- Require per-source API key.
- Optional HMAC signing.
- Source-level schema presets.
- Rate-limited by source and IP.

### CSV Imports

- Manual upload creates source type `csv_import`.
- Original CSV should be stored as a file record.
- Rows can map to records individually or grouped by customer/PO.
- Warnings should reference row and column paths where possible.

### Portal Forms

- Portal submissions may have stronger customer context.
- Still route through the queue in early phases.
- Later trusted portal submissions can be policy-gated for auto-submit.

## Security And Multi-Tenant Considerations

### Tenant Isolation

- Every inbound table should include `organizationId`.
- Internal routes must use `tenantContext`.
- Public source routes must resolve tenant from credential/source, not from request body.
- File records must remain organization-scoped.

### API Keys

- Store only hashed API keys.
- Use visible key prefixes for lookup.
- Support key rotation.
- Scope keys by organization/source.
- Track last used timestamp/IP.
- Allow pause/disable per source.

### Inbound Validation

- Payload size limits.
- Schema validation.
- Strict content type handling.
- Header redaction.
- Unsupported file rejection.
- Date/currency normalization.

### Rate Limiting

Apply limits by:

- Source
- IP
- Organization
- Failed authentication attempts

### File Upload Safety

- Use canonical `file_records`.
- Scan files before approval where possible.
- Quarantine unsafe files.
- Generate previews only after acceptance.
- Never render raw email HTML without sandboxing/sanitization.

### Replay Protection

- Enforce idempotency uniqueness.
- Use HMAC timestamp tolerance for signed sources.
- Store replay attempts as events.
- Return existing record ID for idempotent duplicate submissions when appropriate.

### Audit Logging

- Queue-specific events in `inbound_order_events`.
- Staff actions mirrored to `audit_logs`.
- Permanent quote/order creation should use existing quote/order audit behavior.

## Operational Considerations

### Queue Growth

- Paginate all list endpoints.
- Index by organization, status, and received time.
- Avoid eager joining all files/lines/warnings.
- Add summary counters to records if needed.
- Archive terminal records.

### Retry Handling

Track parse attempts with:

- Attempt number
- Parser version
- Started/finished time
- Error code/message
- Retryable flag

Phase 1 can support manual retry. Later phases can add workers.

### Dead Letter Handling

Move records to coarse status `failed` after repeated failures. If no recovery is expected, move to `terminal` with `reviewOutcome = dead_letter`. UI should provide retry, reject, and archive actions.

### Spam And Junk

Support:

- `terminal` status with `reviewOutcome = spam`
- Source-level block rules
- Sender/domain blocklist
- File-type rejection
- Keyword/pattern rules

### Metrics

Track:

- Records received per source
- Parse success/failure rate
- Average review time
- Submission success/failure rate
- Duplicate rate
- Spam rate
- Warning counts by code
- Confidence distribution
- Time from received to submitted

### Confidence Scoring

Use confidence at both record and field level:

- Customer confidence
- Product confidence
- Line item confidence
- File/artwork confidence
- Total confidence

Confidence should guide review priority. It should not create permanent records automatically in early phases.

### Future AI Extraction

AI should be an extraction assistant, not the source of truth.

Store:

- Provider/model/version
- Prompt/template version
- Extracted JSON
- Confidence/rationale
- Human corrections

AI may assist with:

- Extracting candidate customer/order/line item fields.
- Suggesting product and option matches.
- Summarizing source evidence.
- Creating human-reviewed clarification reply drafts.
- Summarizing customer clarification replies.

AI must not be treated as authoritative. Any AI-inferred business-critical value should either pass deterministic validation or create a human decision flag.

### Operational Safety Recommendations

Explicit safety recommendations:

- AI is an assistant layer, not a source of truth.
- AI-generated customer replies should be draft-only at first.
- Auto-send customer replies should require high source trust, narrow templates, audit logging, and an organization-level policy.
- Auto-submission should be disabled by default and should never be enabled for untrusted public sources.
- Customer matching should require explicit human confirmation below a high confidence threshold.
- Product/material/option inference should create decision flags when ambiguous.
- Parser output should be versioned so parser drift can be detected.
- Confidence scores should be displayed with reasons and blockers, not as standalone green/red truth.
- Source trust level should be visible anywhere automation is suggested.
- Malicious attachments should be quarantined before preview or permanent linking.
- Replay/idempotency events should be logged and visible on the inbound record.
- Human overrides should be auditable, especially for customer match, duplicate dismissal, product match, and ignored blockers.

Specific risk controls:

- AI hallucination risk: require source citations or field evidence pointers where possible; otherwise mark the value as inferred.
- Auto-generated reply risk: show exact draft and recipient before sending; never include unverified pricing or commitments unless generated from TitanOS data.
- Accidental auto-submission risk: require org/source policy, no open blockers, no decision flags, safe files, clean duplicate check, and server-generated submission preview.
- Incorrect customer match risk: show match reasons and conflicting signals; require confirmation for ambiguous matches.
- Parser drift risk: track parser version, confidence changes, warning volume, and correction rate over time.
- Confidence over-trust risk: make low-level field confidence visible, not just record-level confidence.

## Suggested Folder And File Structure

Backend:

```text
server/routes/inboundOrders.routes.ts
server/routes/inboundWebhook.routes.ts
server/routes/portalInboundOrders.routes.ts

server/services/inboundOrders/
  InboundOrderService.ts
  InboundOrderRepository.ts
  InboundOrderValidationService.ts
  InboundOrderSubmissionService.ts
  InboundOrderDuplicateService.ts
  InboundOrderCustomerMatchService.ts
  InboundOrderDecisionFlagService.ts
  InboundOrderReviewSnapshotService.ts
  InboundOrderConversationService.ts
  InboundOrderReplyDraftService.ts
  InboundOrderProductMatchService.ts
  InboundOrderParserService.ts
  events.ts
  schemas.ts
  types.ts
  adapters/
    EmailInboundAdapter.ts
    WebhookInboundAdapter.ts
    CsvInboundAdapter.ts
    PortalInboundAdapter.ts

server/storage/inboundOrders.repo.ts
server/workers/inboundOrderParserWorker.ts
```

Shared:

```text
shared/inboundOrders.ts
shared/inboundOrderSchemas.ts
shared/inboundOrderEvents.ts
shared/inboundOrderDecisionFlags.ts
shared/inboundOrderConversations.ts
```

Frontend:

```text
client/src/pages/inbound-orders.tsx
client/src/pages/inbound-order-detail.tsx

client/src/features/inbound-orders/
  InboundOrdersQueuePage.tsx
  InboundOrderReviewPage.tsx
  components/
    InboundStatusBadge.tsx
    InboundWarningPanel.tsx
    InboundCustomerMatchPanel.tsx
    InboundLineItemsEditor.tsx
    InboundFilesPanel.tsx
    InboundSourcePayloadViewer.tsx
    InboundDuplicatePanel.tsx
    InboundEventTimeline.tsx
  hooks/
    useInboundOrders.ts
    useInboundOrder.ts
    useInboundOrderActions.ts
  types.ts
```

Route registration should follow the extracted route-module pattern already used in `server/routes.ts`.

Internal staff route registration:

```text
registerInboundOrderRoutes(app, {
  isAuthenticated,
  tenantContext,
  isAdminOrOwner,
  assertInternalUser
})
```

Public source route modules should be separate from staff routes because they have different auth/security models.

## Suggested API Shape

Internal staff API:

```text
GET    /api/inbound-orders
GET    /api/inbound-orders/:id
POST   /api/inbound-orders/manual
PATCH  /api/inbound-orders/:id
POST   /api/inbound-orders/:id/assign
POST   /api/inbound-orders/:id/parse/retry
POST   /api/inbound-orders/:id/customer-match
PATCH  /api/inbound-orders/:id/line-items/:lineItemId
POST   /api/inbound-orders/:id/files
POST   /api/inbound-orders/:id/approve
POST   /api/inbound-orders/:id/submit
POST   /api/inbound-orders/:id/submission-preview
POST   /api/inbound-orders/:id/waiting-on-customer
POST   /api/inbound-orders/:id/reply-drafts
POST   /api/inbound-orders/:id/reply-drafts/:draftId/send
POST   /api/inbound-orders/:id/reject
POST   /api/inbound-orders/:id/archive
```

Future public intake API:

```text
POST /api/inbound-webhooks/:sourceKey
POST /api/customer-api/orders
POST /api/portal/inbound-orders
```

## Rollout Plan

### Phase 1: Core Review Queue Foundation

Goals:

- Add coarse inbound queue model.
- Add source trust levels.
- Add warning model.
- Add human decision flag model.
- Add review snapshot model.
- Add internal staff API.
- Add manual inbound creation/upload.
- Add OrderPilot-inspired review workspace.
- Add server-generated submission preview.
- Submit to quote by default.
- Store files through canonical file records.
- Emit inbound events and audit logs.

Implementation recommendations:

- Keep parser simple.
- No public webhooks yet.
- No auto-submit.
- Human approval required.
- Build warning, decision flag, duplicate, trust, and snapshot foundations early.
- Use coarse statuses and derive detailed UI state.

Success criteria:

- Staff can create an inbound record manually.
- Staff can attach files.
- Staff can resolve warnings.
- Staff can accept/override/dismiss decision flags.
- Staff can preview what TitanOS will create.
- Staff can submit to a real quote.
- Approval/submission snapshots preserve reviewed state.
- Existing quote/order/proofing/production/invoice flows remain unchanged.

### Phase 2: Conversation And Waiting-On-Customer Foundation

Goals:

- Add inbound conversation/threading records.
- Add inbound/outbound message history.
- Add waiting-on-customer workflow.
- Add manual clarification request support.
- Add reply association for later emails/messages.
- Add reopen flow after clarification is received.

Implementation recommendations:

- Start with manual staff-authored replies or note-only waiting state.
- Link future replies/files back to the conversation and inbound record.
- Keep reminder automation manual at first.
- Preserve clarification snapshots when important review state changes.

Success criteria:

- Staff can mark an inbound record as waiting on customer.
- Staff can record/send a clarification request.
- Customer replies can be linked back to the same inbound record/conversation.
- New files from replies can accumulate safely.
- Clarification received moves the record back to review.

### Phase 3: Email Parser Integration

Goals:

- Connect configured mailbox/email source.
- Pull or receive email payloads.
- Parse sender/body/attachments.
- Create inbound records automatically.
- Preserve raw email source.
- Thread replies using email headers and subject/sender fallback.

Implementation recommendations:

- Start with deterministic/rule-based parsing.
- Use provider message ID for idempotency.
- Store email body as source payload or file artifact.
- Store attachments as files.
- Keep email results in review.
- Create decision flags for inferred material, product, sidedness, finishing, duplicate, and customer ambiguity.

Success criteria:

- Duplicate emails do not create duplicate active records.
- Email replies attach to the correct conversation where possible.
- Attachments preview safely.
- Parser failures appear in review/dead-letter views.
- Ambiguous AI/parser guesses appear as decision flags.

### Phase 4: Product Matching Improvements

Goals:

- Add product alias mappings.
- Add SKU/external SKU matching.
- Add synonym dictionaries.
- Add customer-specific terminology mappings.
- Add option-level confidence scoring.
- Add material, dimension, and finishing inference.
- Add editable mapping dictionaries.

Implementation recommendations:

- Keep AI suggestions advisory.
- Promote repeated human corrections into reusable mappings.
- Separate deterministic mappings from AI-inferred suggestions.
- Generate decision flags for ambiguous product/option/material matches.

Success criteria:

- Common customer terms can map to TitanOS products/options.
- SKU matches outrank fuzzy matches.
- Option confidence is visible in review.
- Product corrections can become reusable mappings.

### Phase 5: AI Draft Reply Assistant

Goals:

- Generate AI-assisted clarification reply drafts.
- Link drafts to inbound records and conversations.
- Store outbound reply history.
- Add reminder draft support.
- Summarize customer clarifications.

Implementation recommendations:

- Draft-only behavior at first.
- Human review required.
- No auto-send.
- Store AI metadata and missing-field rationale.
- Avoid unverified pricing or commitments in AI text.

Success criteria:

- Staff can generate, edit, approve, and send clarification drafts.
- Drafts cite missing/ambiguous fields.
- Sent replies are visible in conversation history.
- Replies and reminders create events.

### Phase 6: External Customer API And Portal Intake

Goals:

- Add public customer API endpoint.
- Add portal intake source.
- Add API keys and optional HMAC.
- Add idempotency-key support.
- Add JSON schema contract.
- Add source-specific trust policies.

Implementation recommendations:

- Use separate public route modules.
- Derive tenant from API key/session/source credential.
- Require idempotency key for production API clients.
- Offer sandbox/test mode source.
- Use trust level to determine review requirements.

Success criteria:

- External client can submit an order draft.
- Portal submissions create inbound records with known context.
- Replay returns existing record or duplicate response.
- Invalid payloads fail safely with audit trail.
- Staff can review and submit API/portal-created records.

### Phase 7: Advanced Automation

Goals:

- Add n8n/Zapier/EDI adapters.
- Add trusted-source auto-approval policies.
- Add optional auto-send clarification policies.
- Add optional auto-submit-to-quote policies.
- Add advanced duplicate detection.
- Add operational dashboards.

Implementation recommendations:

- Introduce parser and automation policy versioning.
- Store AI extraction metadata.
- Add source-level automation policy:
  - `review_required`
  - `auto_approve_if_no_warnings`
  - `auto_approve_if_no_decision_flags`
  - `auto_send_clarification_if_trusted`
  - `auto_submit_quote`
  - `auto_submit_order`
- Keep direct order auto-submit disabled by default.
- Never allow auto-submission when open decision flags exist.

Success criteria:

- Trusted sources reduce human effort.
- Staff can audit every automated decision.
- AI corrections are traceable.
- No silent order creation without tenant/source policy.

## Risks And Technical Debt

### Likely Bottlenecks

- Product/PBV2 option matching from messy source text.
- File preview and scan throughput.
- Duplicate detection at scale.
- Human review queue growth if parsing quality is poor.

### Architectural Traps

- Creating quotes/orders too early.
- Building a parallel file storage system.
- Bypassing existing pricing/snapshot/routing logic.
- Mixing public intake routes with authenticated staff routes.
- Treating AI extraction as authoritative.
- Letting inbound source payloads mutate after approval.

### Migration Risks

- Enum churn may be painful while workflow states are still evolving.
- Large raw JSON payloads could hurt primary queue performance.
- Nullable idempotency uniqueness needs careful database design.
- Source-specific fields can sprawl if not contained in JSON metadata.

### Scaling Concerns

- Queue list endpoints must not join all line items, warnings, and files by default.
- Summary counts may be needed on `inbound_order_records`.
- Raw payload viewers should lazy-load.
- Terminal records should be archived out of default views.

### Workflow Conflicts

- Direct inbound-to-order can bypass quote approval expectations.
- Direct order creation can conflict with proofing/prepress routing if not reused correctly.
- Auto-submit can create operational surprise if tenant/source policy is unclear.

### Operational Risks

- Spam and junk from public endpoints.
- Malicious files.
- Replay attacks.
- Low-quality customer data creating duplicates.
- Staff over-trusting confidence labels.
- Parser changes causing silent data quality drift.
- AI hallucinating products, materials, or missing-info replies.
- AI-generated replies accidentally committing to price, timeline, or production feasibility.
- Auto-submission creating real quotes/orders without a clear tenant/source policy.
- Incorrect customer matching leaking customer data or creating work under the wrong account.
- Overly broad source trust permissions allowing unreviewed automation.
- Decision flags being treated as cosmetic rather than approval blockers.

## Recommended First Build Target

Build Phase 1 as a TitanOS-native, OrderPilot-inspired review cockpit:

```text
Inbound Queue | Source Evidence | TitanOS Draft Builder
```

The first permanent output should be a TitanOS quote, not an order. That gives the team a safe bridge into the existing approval, proofing, production, fulfillment, and invoice behavior without breaking current workflows.
