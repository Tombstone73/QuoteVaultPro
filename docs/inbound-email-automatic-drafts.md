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

Apply migration `0240_inbound_email_processing_jobs` before running this code.
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
An import interrupted before completion must be imported again; it is not
reported as a completed import and this milestone does not recover Gmail downloads.

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

Mocked tests exercise actual queue/repository transaction bodies, claim SQL,
recovery, parser/draft composition, tenant boundaries and stale-worker fencing.
They are not proof of PostgreSQL lock scheduling, process-death recovery, or
deployment wiring. No identified isolated database was available for this run;
no services were provisioned and no production data was used.

Before enabling a tenant, apply the migration, verify real PostgreSQL contention
and recovery in an isolated environment, confirm tenant/provider configuration,
and perform DEV acceptance using synthetic imported evidence and a test AI
provider. Do not connect a production mailbox or submit an Order to test the worker.

Gmail acknowledgement/read/label handling, quote-linked pending behavior and
broader Assistant integration remain unfinished and unchanged. This is automatic
draft preparation after import, not a complete autonomous email-intake rollout.
