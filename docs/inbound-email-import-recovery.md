# Interrupted Gmail import recovery

## Activation and scope

Recovery is implemented but **disabled by default**. No mailbox, environment or
Google permission is activated by this change. Migration 0242 is required in
addition to 0240 and 0241. It adds durable import/discovery work only; there is no
data backfill or rewrite of historical dispositions.

The recovery worker requires both:

- `WORKER_INBOUND_EMAIL_IMPORTS_ENABLED=true`
- `INBOUND_EMAIL_IMPORT_ORGANIZATION_IDS` with explicit tenant IDs (no wildcard).

`WORKERS_ENABLED=false` overrides it. The worker ticks at startup and every 30
seconds, handling at most three claims per normal tick. It resumes previously
scheduled work; it does not discover new mailboxes or periodically scan Gmail.
Existing intake enablement, pull pause, enabled mailbox, provider and account
identity remain enforced. Disabled or paused work stays durable.

The existing AI preparation rollout control is separate and stays disabled.
Recovery can finish an import and enqueue its AI evidence job while AI execution
remains paused. Staff still review and approve Order creation through the existing
canonical flow. Recovery cannot create an Order, change a job, dismiss an inbound
request, mark Gmail read or apply Gmail labels.

## Durable discovery

An authorized **Pull Latest Emails** creates a discovery job before calling Gmail.
It captures the query, label filters, hard result limit (1–100), importing actor and
mailbox account identity. Relative `newer_than`/`older_than` filters are frozen into
absolute time boundaries; an upper boundary prevents new arrivals from shifting
the scan during recovery. Existing read-state widening and configured filters are
retained. An explicit custom query is not silently narrowed to a different lower
date boundary. Month/year relative durations use 30/365-day intervals.

Each listed page commits its provider IDs and next page token in **one** database
transaction. Only then may listing advance. A crash before that commit retries the
saved page and absolute window; a crash after it resumes the saved next cursor.
Message jobs use a tenant/mailbox/provider/message unique identity. A detail-fetch
failure never loses a listed ID. Recovery fetches persisted message IDs directly,
independently of lastPulledAt or the current lookback window.

Only one unfinished discovery exists per mailbox. A failed scan must be retried
and resolved before a new window replaces it. An invalid saved page token (HTTP
400) restarts the same frozen, bounded window with idempotent ID scheduling and a
bounded retry budget. There is no unbounded historical sweep; messages never
listed within the configured query/result cap remain outside this milestone's
guarantee. Gmail search/query semantics and cursor behavior still need DEV
acceptance. No client-side read/label state acts as completion.

## Claims, interruption and retries

Discovery and message work share the durable import queue. Claims use mailbox row
locking and SKIP LOCKED, with at most one active importer per mailbox. Different
seeds in one thread therefore converge through existing thread identity and
attachment deduplication. Five-minute leases heartbeat every 100 seconds; recovery
assigns a fresh random fencing token. At most three automatic attempts are allowed,
with 30/60-second retry backoff. Three abandoned leases produce a visible failure.
Provider access/missing-message failures stop automatically; IDs remain for staff.

Every inbound evidence mutation and storage-link commit checks the live import
claim under the existing tenant advisory/evidence lock. An AsyncLocalStorage
context carries only that technical fence through the canonical repository and
storage callbacks. New record insertion binds the import job and incomplete marker
in the same transaction. An expired/replaced worker cannot write attachments,
refresh evidence or publish import completion. Canonical createFile also checks
provider attachment identity while holding the evidence lock, closing its previous
lookup/insert race. AI/Gmail/download calls hold no database transactions or locks.

Download failures retain explicit attachment rows and the original provider
manifest. A later attempt reuses available files and downloads only missing/failed
ones. Existing failed rows no longer suppress backfill merely because an attachment
ID exists. Permanent or unavailable attachments remain visible for staff action.
Detailed provider exception text is not stored in queue errors or written to logs.
Diagnostics use safe codes and identifiers; no OAuth credentials or email bodies
are included in recovery errors. Pull diagnostics use the mailbox's own durable
discovery checkpoint, not shared mutable adapter diagnostics. A failed/partial
import does not report the mailbox pull as successful.

The intake screen's **Email import progress** panel shows discovery/importing,
retrying, failed and needs-attention work, independently of AI and business status.
It shows the oldest 100 unfinished jobs. Linked jobs can open their exact inbound
request. **Retry import** resets only failed/attention work, records the staff actor
and appends an inbound audit event when linked. It cannot steal active work or
enable automation. With recovery paused it queues work for later execution; an
authorized manual pull can also drain eligible retained message jobs.

## Evidence completeness and staff decisions

An incomplete marker plus persisted pending-job checks block parsing, ready/approval
and inbound conversion on the server, including direct requests. Discovery of
another message in the same mailbox/thread also blocks stale approval before that
message has an inbound linkage. Known unavailable, untrusted, blocked or scan-pending
attachments remain needs-attention and cannot produce an approval-ready draft.
Inline/signature exclusions and deliberate staff OTHER exclusions use existing
classification metadata. Retrying preserves staff classifications, roles and edits;
it does not silently reclassify an excluded file as a PO or approve quarantined art.

Completeness is cleared only when required evidence is available or deliberately
excluded, and no other pending work for that request/thread remains. Completion and
the canonical completeEmailImport/AI scheduling transaction commit together. Failure
rolls both back. Repeated recovery cannot duplicate initial drafts; existing drafts
still require deliberate refresh/reconciliation after relevant evidence changes.

Quote/Order links, staff draft edits and prior dismissal events are retained. Later
evidence reopens review through the existing fingerprint protocol, with the earlier
link visible. Recovery cannot automatically create another Order or modify a linked
job. Canonical Quote conversion does not resolve an import that is still incomplete.

## Reproduce validation

Known unavailable legacy attachment rows fail the shared completeness check even
when no import job or incomplete marker predates them. This does not enroll old
work or imply that missing legacy manifests were recovered.

Use the existing isolated setup; it now includes the import recovery suite:

```powershell
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1
# First use on another Windows checkout, if no complete PG runtime is supplied:
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1 -DownloadRuntime
```

See [PostgreSQL validation setup](inbound-email-postgres-validation.md). Canonical
migrations, all ledger hashes/timestamps, protected integrity and release checks
remain required. Tests use actual PostgreSQL transactions and separate connections;
Gmail/AI are stubbed and physical storage I/O is replaced by a boundary fixture
whose file records and canonical persistLink use real database transactions.

The recovery cases cover discovery interruption, atomic page checkpointing, moved
windows, invalid cursor restart, partial attachments, competing and abandoned claims,
stale importer fencing, bounded retries, staff retry, unavailable evidence, rollback,
blacklist/account/tenant gates, one AI handoff, staff edits and later evidence on
linked/dismissed threads. One test terminates an actual importing worker process
after inbound persistence at its download boundary, expires only its synthetic
lease, and verifies a new worker recovers without another record or attachment.
This is real process/DB recovery, not a mocked transaction scheduler.

## Validation results

Validated locally with PostgreSQL 16.4: **78 database cases passed** (the previous
56 plus 22 recovery cases), including all 236 canonical ledger identities and 80
release checks. Separate suites passed **265 mocked server/API tests** and **16
frontend tests**; these are not counted as database cases. Gmail requests have a
60-second client timeout; real provider timeout behavior still needs DEV acceptance.
Scoped TypeScript (20 changed source/test inputs, zero diagnostics) and protected
migration integrity checks pass. No full build/typecheck is needed.

## Remaining rollout work

- Review/apply migrations **0240, 0241 and 0242** in the intended shared environment.
- Deployed Neon transport, process lifecycle, real Gmail query/cursor/timeout and
  storage-provider behavior remain unverified by local fixtures.
- Gmail acknowledgement/read/label policy remains unfinished. No permission changes.
- Legacy imports interrupted before durable discovery tracking are not automatically
  enrolled. Reconciliation of their manifests/linkages and queue volume remains an
  explicit rollout task; no historical mailbox scan or bulk disposition backfill runs.
- DEV acceptance with synthetic evidence, real configured test boundaries and human
  approval remains required. Neither import recovery nor AI automation is enabled.
