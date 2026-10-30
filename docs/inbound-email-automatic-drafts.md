# Automatic preparation of imported email review drafts

This milestone prepares editable inbound review drafts only. It cannot create an
Order or Quote, approve a draft, dismiss an email, acknowledge Gmail, mark mail
read, or change labels. Existing human approval and evidence checks remain required.

## Rollout: off by default

No environment or mailbox settings are changed by this implementation.
The worker requires both:

- `WORKER_INBOUND_EMAIL_DRAFTS_ENABLED=true`
- `INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS` containing an explicit, comma-separated
  allowlist of tenant IDs. Empty lists and `*` do not enable processing.

`WORKERS_ENABLED=false` overrides the worker switch. The existing organization's
inbound-intake feature switch is also respected; pausing Gmail pulls only pauses
pulls, not preparation of already imported evidence. The polling interval uses
`WORKER_INBOUND_EMAIL_DRAFTS_INTERVAL_MS` (30 seconds by default, minimum 5 seconds).
Configuration changes require the normal application restart/deployment.

Apply migrations `0240_inbound_email_processing_jobs` and
`0241_inbound_versioned_fingerprint_width`, plus `0242_inbound_email_import_recovery`
for durable discovery/import recovery, before running this code.
The additive migration creates only local work metadata. It contains no data
backfill, mailbox activation, or production integration calls.

Imports persist work even while execution is disabled. Nothing scans or enrolls
historical mailboxes/records. An eligible completed import or explicit reimport
registers that record. Later evidence changes on registered records retain work
for the new identity regardless of whether the worker is currently enabled.

## Durable scheduling and execution

The ingestion completion transaction runs after available attachments and their
metadata have been persisted. It takes the same tenant evidence advisory lock
and inbound row lock as evidence writers and approval. Evidence identity and a
unique `(organization_id, inbound_record_id, evidence_fingerprint)` job are
committed together. Repeated imports cannot reset an active or failed run.
Interrupted imports are now covered by the subsequent
[durable import recovery milestone](inbound-email-import-recovery.md). It saves
provider identities and page checkpoints and resumes attachments through this
canonical ingestion path. Import recovery has its own disabled-by-default rollout
gate; incomplete evidence cannot pass parsing/approval or AI scheduling.

Workers claim with `FOR UPDATE SKIP LOCKED`. Claims last five minutes, with
heartbeats every 100 seconds and a new random fencing token on recovery. At most
three automatic attempts are permitted. Failure backoff is 30 then 60 seconds;
repeated abandoned claims become a visible terminal failure after their leases
expire. A staff retry resets only a failed, unconverted record without a staff
draft. It cannot steal active work. Retry queues work and never invokes AI inline.

AI calls, attachment evidence reads, candidate resolution and draft preparation
run outside transactions/locks. Every automatic publication of parse state and initial draft
write rechecks the live claim, rollout/tenant eligibility and source fingerprint
under the existing evidence lock. An expired or superseded worker cannot publish
a draft. Late parse attempts can remain as audit history but cannot cover newer
evidence or authorize a draft. Successful tracked parses can be reused after a crash before draft
initialization; initialization uses the canonical draft operation with its
expected-empty-snapshot check. Manual and automatic preparation cannot produce
two initial editable drafts.

## Review and business disposition

Technical job states are waiting, processing, review-ready, needs-attention,
failed and superseded. They are displayed for the selected unconverted email,
with a safe retry action for failures. The business disposition is unchanged by
automatic parse activity; only technical `parsedAt` and audit metadata are updated.

Non-order, uncertain, incomplete, duplicate and revision findings remain visible
in the canonical editable review draft. They never cause automatic dismissal or
Order creation. Existing blacklist/internal-sender import boundaries are unchanged.

If an editable draft already exists, automatic work retains it. New evidence
invalidates its coverage through the existing evidence protocol and produces a
needs-attention work state. Staff use Parse followed by deliberate refresh or
reconciliation; this worker never calls the refresh operation. Legacy untracked
drafts retain the preceding milestone's tracked-parse/explicit-refresh policy.

Background UI refresh updates evidence and parse visibility only. It does not
invalidate the editable draft query or replace unsaved form edits.

Queue diagnostics and worker logs contain fixed safe codes/messages and record/job
identifiers, never provider exception text, email bodies, attachment contents,
credentials or claim tokens. Detailed parser diagnostics remain in the existing
authorized review interface.

## Validation and rollout prerequisites

The isolated PostgreSQL verification milestone is documented in
[inbound-email-postgres-validation.md](inbound-email-postgres-validation.md).
It supersedes the earlier database-verification limitation below: real PostgreSQL
now exercises transitions, contention, fencing, rollback and killed-worker recovery.
External AI responses and attachment reads remain deterministic stubs.

Earlier mocked tests exercise actual queue/repository transaction bodies, claim SQL,
recovery, parser/draft composition, tenant boundaries and stale-worker fencing.
They are not proof of PostgreSQL lock scheduling, process-death recovery, or
deployment wiring. At the original implementation milestone no identified isolated
database was available; the later verification uses only a repository-owned local
cluster with synthetic records and never copies production data.

Before enabling a tenant, apply both migrations, retain the isolated PostgreSQL
verification gate, confirm tenant/provider configuration,
and perform DEV acceptance using synthetic imported evidence and a test AI
provider. Do not connect a production mailbox or submit an Order to test the worker.

Gmail acknowledgement/read/label handling and broader Assistant integration remain
unfinished. Durable interrupted-import recovery is now implemented separately and
disabled by default; pre-tracking legacy imports still require reconciliation. This is automatic
draft preparation after import, not a complete autonomous email-intake rollout.

## Inbound queue accountability milestone

Automatic processing remains disabled by default. This milestone does not change
mailbox settings, rollout environment variables, Gmail state, or production jobs.
It requires the same migration 0240 as the preceding milestone; there is no new
migration or data backfill. Apply nothing to a shared environment as part of local
validation.

### Resolution and visibility

The repository uses one business bucket projection for queue filters and counts.
AI job completion and parsing do not resolve business work. A linked Quote with
no Order remains pending as **Awaiting quote acceptance**, including legacy
records whose stored status says submitted/approved or downstream_quote_completed.
The raw status and audit history are retained; queue membership is the projection,
not an in-place historical rewrite. Approval/status callbacks on Quotes cannot
resolve an inbound item.

Canonical Quote-to-Order conversion now records reciprocal inbound linkage in its
existing transaction, including safe idempotent retries. It resolves only the
fingerprint captured when that Quote was prepared, or the tracked snapshot named
by its original quote-created event. A Quote converted after newer evidence arrives
links the resulting Order but leaves the newer evidence pending. Converting again
returns the existing Order without acknowledging a subsequent revision.

Resolution requires an actual tenant-owned Order (checked by the queue SQL) or
an explicit staff dismissal. Existing Order attachment remains the canonical
manual action for associating reviewed evidence with a job. Its attachment/audit
writes and evidence resolution now share the evidence transaction. Repeated or
competing requests for the same evidence do not repeat attachments/audit effects.
The existing Order's commercial lines/prices/progress are not changed by this action.
An existing link cannot be reassigned to a different Order from this action.
A merged source that receives subsequent evidence keeps the combined parent's
verified Order visible through a tenant-scoped read projection. It can be reviewed
against that Order and cannot claim a second Order or Quote.

The current evidence identity and resolution identity are separate values in
normalizedPayloadJson. Resolution stores kind, fingerprint, Order ID if applicable,
actor and timestamp. Relevant evidence changes set unresolvedEvidenceFingerprint,
reopen needs_review, clear queue archival, and append an evidence.reopened event.
When staff deliberately marks a newly parsed, unlinked request ready, superseded
resolution metadata is cleared from the current projection; the earlier versioned
decision remains in its audit event. This permits a genuinely new request after
dismissal to use the existing human-approved Order path.

Previous disposition, links, source files, parse history and editable snapshots
are preserved. Prior job linkage is visible beside the new evidence; automatic
processing excludes both created and explicitly attached Orders. No new Order
or job modification is triggered by reopening.

Ignore-once, reject and soft queue deletion remain deliberate audited operations.
Ignore-rule creation/conflict resolution and its inbound disposition share the
evidence transaction, so a stale/failed dismissal does not leave a partial rule
change. Reopening a dismissal is explicit and remains visible until handled again.
Email dismissal and attachment requests must carry the evidence fingerprint shown
to staff; missing/stale versions fail with a refresh-and-review instruction. Bulk
dismissal supplies per-record versions. Evidence arriving after any of these
staff decisions reopens review. Ignore sender/domain/subject rules still suppress
future imports according to the existing blacklist policy; this milestone does
not bypass those rules to fetch previously blocked mail. A late AI result cannot
dismiss reopened evidence or replace a staff draft.

### Legacy compatibility and reconciliation

No historical dispositions or draft coverage are bulk rewritten. Legacy Order-linked
and dismissed records retain their historical disposition until an evidence writer
observes a change. For records without any prior fingerprint, the writer captures
a comparison identity under the existing lock before changing evidence. This is a
change-detection baseline, never a claim that a legacy review draft covered it.
Legacy untracked drafts still require the earlier tracked-parse/deliberate-refresh
protocol for approval. Legacy attached-to-order records remain resolved through
their existing attachedOrderId when it identifies a tenant-owned Order.

Legacy quote-only records become visible via the pending projection without a
backfill. A missing/inaccessible Order, or a submitted/approved record without an
actual Order or deliberate dismissal, is not evidence of completion and remains
pending. Queue volume from these formerly hidden records must be assessed during
DEV acceptance. Missing legacy Quote snapshot coverage is fail-closed: conversion
can link the actual Order, but staff must reconcile/dismiss the untracked evidence.
Existing quote-to-order conversions that predate this hook and lack inbound Order
linkage require a deliberate replay of the canonical conversion (which reuses the
Order), or another reviewed canonical attachment; no automatic historical sweep
runs here. There is no silent stamping of old drafts with current evidence.

### Locking and verification limits

Evidence writers, dismissal, explicit attachment, and conversion use the existing
tenant advisory lock and inbound row locks. Quote conversion obtains the evidence
advisory lock before its Quote row lock to maintain a consistent ordering. No AI
or Gmail call is added inside a transaction. The original mocks model transaction
serialization, rollback, SQL participation and version decisions. The subsequent
isolated PostgreSQL milestone executes the actual CASE/joins, separate-connection
contention, rollback, fencing and killed-process recovery. Its provider calls are
stubbed; it does not establish shared-environment or mailbox readiness.

Gmail reconnect is also blocked in deployed DEV by a frontend callback URI reaching
the SPA. The separate [reconnect milestone](inbound-gmail-reconnect.md) fixes backend
URL construction and documents the required DEV Google redirect allowlist/config
review; successful reconnect still needs deployed acceptance.

Remaining rollout gates: migrations 0240, 0241 and 0242 readiness/application in the intended
environment; import recovery activation and deployed provider acceptance; Gmail acknowledgement/read/label policy;
legacy reconciliation and queue-volume assessment;
and DEV acceptance of queue counts, legacy volume, revision review and human
approval using synthetic evidence. Nothing is pushed, deployed, enabled or
live-validated by this milestone.
