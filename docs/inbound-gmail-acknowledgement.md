# Gmail acknowledgement after reviewed Order linkage

## Implementation and reconnect

Callback correction **21b40c393** is present after recovery **298c7a7aa**. The backend
registers `/api/inbound-orders/email/mailboxes/gmail/callback` before SPA fallback.
Browser API calls and OAuth use their canonical backend, while settings returns
use `APP_PUBLIC_WEB_ORIGIN` (legacy `APP_URL` fallback). Vercel's intentional SPA
catch-all remains unchanged; no broad API proxy or frontend callback is added.

Before DEV acceptance, the DEV Railway API service must use:

- `APP_PUBLIC_WEB_ORIGIN=https://dev.printershero.com`
- Optional `GOOGLE_INBOUND_OAUTH_REDIRECT_URI` set exactly to
  `https://api-dev.printershero.com/api/inbound-orders/email/mailboxes/gmail/callback`
  (removing an incorrect override also uses that default).

That exact backend URI, without a trailing slash, must be registered under
**Authorized redirect URIs** on the Google Web application client identified by
DEV's `GOOGLE_CLIENT_ID`. Do not substitute a JavaScript origin. MAIN is separate:
its backend is `https://api.printershero.com`. No MAIN configuration changes occur.
External Railway values and Google's redirect allowlist were not verified or
changed in this milestone; management access has not been established. Previous
read-only DEV observations are in [reconnect findings](inbound-gmail-reconnect.md).
They establish the old blocker, not current credential validity or a successful
reconnect. No real account reconnect or token probe is performed by these tests.

New inbound connections/reconnects request **gmail.modify**, userinfo.email and
userinfo.profile. No send, full-mail or additional Google service scope is added.
Review the Google consent screen's restricted-scope/test-user/verification setup
before acceptance. Existing readonly credentials remain usable for imports;
settings separately report that acknowledgement needs reconnection.

Signed tenant/mailbox/actor state, expiry, verified profile, owner/admin initiation
and tenant-scoped transactional storage are preserved. A missing replacement
refresh token is accepted only when an existing same-account refresh credential
can be retained. An account mismatch or absent usable credential fails without
changing the connection. Replacement tokens do not inherit legacy OAuth client
credentials. Background access uses the shared import credential constructor;
before writes it verifies the refreshed token's actual scopes and Gmail profile
account. Scope metadata alone is not proof that the retained token can modify.
Token refresh, token-info and Gmail requests have a 60-second client timeout.
Errors use safe categories, never authorization codes, tokens or callback queries.

## Scheduling and evidence coverage

Additive migration **0243** creates `inbound_gmail_acknowledgements`. It is an
outbox with immutable tenant, inbound, Order, mailbox account, evidence fingerprint
and message-ID manifest. Its unique key prevents duplicate scheduling for the
same tenant/inbound/mailbox/evidence. All earlier migration SQL remains unchanged.

The existing canonical transaction schedules the outbox only after:

- successful reviewed inbound-to-Order completion;
- explicit staff attachment to an actual tenant-owned Order with current complete
  evidence; or
- canonical Quote conversion linking its actual resulting Order.

Failed conversion rolls back Order/linkage, evidence resolution, events and outbox
together. Draft preparation, approval alone, Quote creation/status, dismissal and
AI classification schedule nothing. A retry of an existing conversion does not
resolve or acknowledge later evidence.

IDs come only from persisted reviewed message evidence, never from a live thread
lookup. New combined-source snapshots include a hashed, frozen source-message
manifest. Quote creation also freezes its reviewed manifests: if a new reply
arrives before conversion, the resulting Order can acknowledge only the older
Quote-covered IDs while the newer evidence remains pending. Legacy Quotes without
a frozen manifest cannot reconstruct older IDs from newer evidence and do not
acknowledge it automatically. The existing current-fingerprint safeguards remain.

Acknowledgement never creates/recreates an Order, edits jobs or drafts, clears
unresolved evidence, dismisses a request or changes local business disposition.
Direct Order attachment now checks import completeness as well: unavailable files
must be obtained or deliberately excluded through the existing review controls.
It does not mark source art approved or alter proof requirements.

## Provider operations and recovery

The worker checks the retained mailbox ID/account and live lease before each remote
write. It finds the exact user label **Entered**, or creates it with existing Gmail
label conventions. If a create response is lost or conflicts, it re-lists by name
instead of inventing another label. It uses `users.messages.batchModify` in chunks
of 500 fixed IDs, adds only Entered and removes only UNREAD. It never modifies a
thread, archives mail or sends an acknowledgement email. New replies outside the
manifest remain untouched, even if Gmail displays aggregate thread labels.

API references: [message label updates](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify),
[label creation](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/create).

At-least-once delivery is intentional. Repeating label addition/removal for the
same messages is safe if Google committed but the response/local completion was
lost. This is not a distributed exactly-once transaction with Google. An already
in-flight request cannot be recalled after a pause or lease replacement; every
such request is limited to the same previously authorized immutable IDs.

Mailbox-row `FOR UPDATE SKIP LOCKED` serializes competing workers per mailbox.
Five-minute leases heartbeat every 100 seconds, with fresh random fencing tokens
on recovery. Expired workers cannot complete or fail a replacement claim. Three
attempts and 30/60-second backoff bound transient failures and abandoned recovery.
No Google/network call holds a database transaction or lock. Gmail success and
its audit event commit together. A killed process retains its outbox and lease.

Missing modify grants, expired credentials and permission failures stop as
**Reconnect required**. Rate-limit 403/429 and transient provider failures retry;
missing source/account conflicts need staff attention. Exhaustion is visible.
Staff can retry only terminal/reconnect/attention work; retry resets a bounded
budget and audits the actor. It has no Order-conversion entry point. Reconnect
does not silently restart old Gmail updates: staff deliberately retry them.

The intake's **Gmail updates for entered Orders** panel remains visible independently
of AI intake enablement. It shows the oldest 100 unfinished jobs, explains paused,
pending, reconnect and failed states, links to the exact inbound request/settings,
and provides safe retry. It never replaces cached editable drafts. Success is
recorded in the existing event history; no success is shown before completion.

## Disabled rollout and legacy policy

All switches remain off; no existing mailbox setting or shared environment is
changed. Execution requires **all** of:

1. `WORKER_INBOUND_GMAIL_ACK_ENABLED=true`.
2. `INBOUND_GMAIL_ACK_ORGANIZATION_IDS` containing explicit allowed tenant IDs;
   wildcard enrollment is rejected.
3. Enabled Gmail mailbox with `settings.gmailAcknowledgementEnabled=true`.
4. Actual credential scope/account checks and a current work claim.

`WORKERS_ENABLED=false` overrides the worker. It ticks at startup/every 30 seconds,
up to three jobs per tick. Recovery and automatic AI preparation retain their
separate disabled controls. Staff mailbox settings are managed by existing
owner/admin permissions. A reconnect preserves disabled/default and enrollment
settings; granting modify is not activation.

Mailbox enrollment affects **future resolutions only**. It does not scan or
backfill historical Orders, mail or dispositions. Jobs enrolled while the worker
is paused remain durable for deliberate later activation. Importantly, enabling
the mailbox after an old resolution does not retroactively enqueue it. Legacy
records with no reliable mailbox/message manifest are not guessed. Legacy combined
sources lacking frozen child IDs produce attention work that cannot be retried
into writes; deliberate source reconciliation/new review is required. No bulk
reconciliation or repair is included. Ambiguous combined account identities are
also held for reconciliation without rolling back the valid Order or permitting
a retry into the wrong account. Non-email primary records are not automatically
acknowledged; choose an email primary for a new combined email review so the
existing tracked-evidence approval rules apply. Outbox foreign keys retain mailbox/Order
history; deleting a mailbox with acknowledgement history requires a reviewed
retention policy (disabling it pauses writes without deleting work).

## Reproduce validation and remaining acceptance

```powershell
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1
# On first use only if the complete pinned runtime is absent:
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1 -DownloadRuntime
```

The same guarded disposable PostgreSQL 16 setup now includes acknowledgement.
The canonical runner applies 0240–0243 and the historical chain, verifies actual
ledger hashes/timestamps and release checks. Gmail/AI stay stubbed at their
boundary. Tests exercise real rollback, separate-connection claims/locks, fencing,
exhaustion, staff retry and worker-process termination at a simulated remote-success
boundary. This does not establish real Gmail availability, label propagation,
deployed process behavior or storage-provider correctness.

### Validation results

- **107 real PostgreSQL cases passed**: the previous 78 plus 29 acknowledgement
  cases, with actual worker-process termination and separate connections.
- **395 focused mocked server/API tests** and **41 frontend tests** passed.
- Scoped TypeScript over **26 changed source/test inputs** passed with zero
  diagnostics using the established 8 GB heap. No full build/typecheck ran.
- All **237 migration ledger identities**, protected integrity and **80 release
  checks** passed. The disposable cluster is stopped and removed by the runner.
- An older attachment regression fixture now explicitly records staff exclusion
  for its unavailable file; a new negative case proves incomplete evidence cannot
  be resolved by a direct attachment request. Assertions were retained.

Remaining acceptance, in order:

- Review shared-environment migration identity/readiness for **0240–0243**, protected
  integrity and recovery/backup arrangements; apply only after separate authorization.
- Deploy the intended DEV commit after authorization; verify the deployed backend
  and frontend SHA, callback routing and exact DEV Google redirect configuration.
- Review the Google consent configuration and reconnect a designated test mailbox
  through the real flow; confirm same-account credential continuity/actual modify
  access. Do not use production customer email for first acceptance.
- Verify provider/storage downloads, safe imports, deployed Neon transaction and
  lease behavior (tests use local pg, not Neon's deployed WebSocket transport).
- With explicitly enrolled synthetic test evidence and scoped activation, validate
  end to end: discovery/import, AI draft, staff edits/approval, saved Order readback,
  pending new reply, Entered/read updates, a retry and no duplicate Order.
- Reconcile legacy coverage/linkages/combined manifests and assess queue volume.

For **imported messages**, automatic draft preparation, evidence safeguards, queue
accountability, interrupted-import recovery, reconnect code and durable Gmail
acknowledgement are implemented. This is not rollout readiness. Discovery still
starts through the existing Pull Latest Emails entry point; this milestone adds
no unattended periodic mailbox scan or broader Assistant integration. Nothing is
pushed, deployed, enabled, migrated in a shared environment or provider-accepted.
