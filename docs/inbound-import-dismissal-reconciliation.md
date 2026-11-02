# Import attention after staff dismissal

Queue dismissal previously resolved the inbound evidence without resolving the
durable import job. Import progress kept counting that job, and retry could queue
it again independently of staff disposition.

The shared reconciliation runs inside the existing tenant evidence lock, after
the canonical dismissal audit is written in the same transaction. It also runs on
progress reads, before recovery claims, and before staff retries. Existing stale
warnings therefore have an idempotent reconciliation path without a data repair
script, record deletion, Gmail call, or worker activation.

Automatic resolution requires all of:

- A retained email record with a current deliberate dismissal resolution.
- Matching current evidence fingerprint, staff identity and dismissal audit.
- Matching Gmail mailbox/account/message manifest and durable job identity.
- No Order/Quote linkage, combined-source conflict, related inbound request,
  shared physical evidence, or canonical commercial/production file association.

An eligible job becomes `skipped` with `IMPORT_DISMISSED`. Its source identities,
files, quarantine, attempts and audit history remain. A new audit stores its prior
status/error/message and whether an active claim was superseded. Claims are
cleared atomically so late workers cannot publish or recreate the warning.
Changed evidence or deliberate reopening invalidates that resolution and returns
the import to attention; it never approves incomplete evidence or overwrites edits.

Unaudited legacy terminal records, missing records, changed evidence, ownership
conflicts and unrelated failures remain actionable. No new manual override of
these protections is provided: use Open inbound request to review the retained
source/history and existing explicit disposition/reopen controls. Retrying never
silently reopens a valid dismissal.

The progress panel counts active states only. Show import history includes up to
100 recent completed/excluded/dismissed jobs, separately labelled and without retry
for terminal jobs. Prior failures and superseded attempts are retained in the
linked request's audit. Its collapsed preference and internal height limit stay
unchanged. Dismissal mutations invalidate progress immediately.

Validation uses disposable loopback PostgreSQL and synthetic records. The provider
and physical upload I/O are controlled fixtures; database transactions, evidence
fingerprints, service transitions, recovery claims and linkage queries are real.
No operational mailbox, hosted evidence or live customer request is changed.
No migration or production/MAIN rollout of this fix is required or performed.
