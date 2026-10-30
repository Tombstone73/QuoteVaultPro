# AI email intake: DEV rollout preflight, 2026-10-30

## Verdict: blocked before integration or deployment

The live read-only DEV preflight found conflicting protected migration identities.
Do not push this feature into DEV until the journal has a reviewed reconciliation
and the resulting migration chain has been verified against DEV's actual schema.
No shared migration, hosting variable, mailbox, Gmail message or business record
was changed during this preflight. MAIN and the separate work branches are untouched.

### Verified targets

- Remote `dev` and `main`: `41aa8305a32fcea3caa35e322d0f3a036f142a85`.
- Feature starting revision: `4d7480ad5` on `feat/ai-email-intake`.
- Vercel DEV project: `printershero-development`,
  `prj_99vkqciRVxBZqklDmmAZitWJnxyJ`.
- DEV frontend alias serves deployment `dpl_9fiTctSc55zkHg9KQuUMuWdtC8aJ`,
  revision `41aa8305a32fcea3caa35e322d0f3a036f142a85`, READY.
- Railway project: `2f6457af-de54-485d-b06f-0a1c1e0f2e64`, service
  `31b4da75-c583-4f1b-bcb9-39c130cd716e`, Development environment
  `fd7aa163-90bc-49f2-ba9b-5b62bbe0283f`.
- Railway active deployment: `92408045-e949-47ce-aa96-97a2369da174`.
  The container reports the same `41aa8305a...` revision, `APP_ENV=development`,
  `APP_PUBLIC_WEB_ORIGIN=https://dev.printershero.com`, and
  `API_PUBLIC_BASE_URL=https://api-dev.printershero.com`.
- Database endpoint identity matches the previously approved DEV QA fingerprint;
  Railway environment ID also matches its approved value. Application and migration
  URLs use the same Neon endpoint (pooled application/direct migration).
  Credentials were neither copied nor printed.

### Migration readiness findings

The Railway console used the deployed Node runtime at
`/mise/installs/node/22.23.3/bin/node`, the existing Neon driver and the direct
`MIGRATION_DATABASE_URL`. Database inspection ran inside `BEGIN READ ONLY` /
`ROLLBACK`. No migrator was invoked against shared DEV.

Actual ledger `public.__drizzle_migrations_v2`: **235 rows**, frontier
`1793491200000`. The deployed journal has 236 entries. Its last three migrations
match the ledger's exact source hashes and timestamps:

| Journal idx / timestamp | Already applied DEV identity | Feature identity using the same position |
| --- | --- | --- |
| 239 / 1793318400000 | 0240_proof_early_production_release | 0240_inbound_email_processing_jobs |
| 240 / 1793404800000 | 0241_linked_redo_orders | 0241_inbound_versioned_fingerprint_width |
| 241 / 1793491200000 | 0242_redo_customer_charges | 0242_inbound_email_import_recovery |

The feature's 0243 acknowledgement migration is later, but running this journal
on DEV would skip the earlier intake migrations because Drizzle uses the ledger's
maximum timestamp. Choosing either side of the JSON merge conflict does not fix
this. Both branches have protected integrity manifests. No SQL source, journal,
manifest, ledger row or migration guard has been rewritten to conceal the issue.

The deployed journal comparison also found **seven pre-existing identity
discrepancies** (229 of 236 entries match exact hash + timestamp):

- `0001_stations`: SQL hash exists at ledger timestamp 0, journal timestamp 1.
- `0016_line_item_proofing_foundation`: same SQL hash exists at 1773842340434.
- `0017_line_item_proof_manual_approval_overrides`: same SQL hash exists at
  1773872609328.
- No matching current SQL hash was found for `0003_active_job_uniqueness`,
  `0004_line_item_status_cleanup`, `0015_quote_line_item_routing` or
  `0097_product_intake_ai_diagnostics`. The latter's journal timestamp is present
  with a different hash. This does not establish that the intended schema change
  is missing; its provenance and actual postconditions require reconciliation.

The new processing/import/acknowledgement tables are absent from actual DEV.
The existing inbound tables remain present. Synthetic-foundation PostgreSQL
success does not resolve this deployed-history difference.

Reproduce the **Git identity** comparison without merging or changing anything:

```powershell
git fetch origin
node scripts/qa/check-inbound-dev-migrations.mjs origin/dev HEAD
node --test scripts/qa/check-inbound-dev-migrations.test.mjs
```

The first Node command intentionally exits 1 for the current branches. It compares
journal positions, timestamps, tags and SQL Git blobs; it does not connect to a
database or replace the canonical integrity/journal checks.

Proposed release reconciliation, pending explicit review: preserve DEV's applied
history and SQL; append the never-shared intake SQL under fresh identities after
DEV's frontier (0243–0246), document the old-to-new identity mapping, and test both
the resulting journal and actual DEV prerequisites before invoking `runMigrations()`.
This requires reviewing the feature branch's existing protected journal, rather
than silently refreshing its anchor. Do not stamp missing historical migrations
as applied or edit their SQL. Review the seven baseline discrepancies separately.

## Unattended discovery implementation

Previously discovery originated only in the authorized Pull Latest Emails route.
The import recovery timer resumed persisted work but never began a new scan.

The existing long-lived Railway backend now has a default-off discovery timer in
`server/index.ts`: startup and every 60 seconds. It calls
`InboundEmailIngestionService.scheduleAutomaticDiscovery()`, which uses the
existing import repository and queue. It performs no Gmail/AI calls and creates
no Order. Each eligible mailbox receives at most one new scan per five minutes.
Scheduling requires **all** of:

1. `WORKERS_ENABLED` is not false.
2. `WORKER_INBOUND_EMAIL_DISCOVERY_ENABLED=true`.
3. Import recovery enabled through `WORKER_INBOUND_EMAIL_IMPORTS_ENABLED=true`.
4. Explicit tenant in `INBOUND_EMAIL_IMPORT_ORGANIZATION_IDS`.
5. Explicit mailbox ID in `INBOUND_EMAIL_DISCOVERY_MAILBOX_IDS`; wildcard alone
   does not enroll any mailbox.
6. Enabled Gmail mailbox, active/nonarchived organization and enabled/unpaused
   intake. The mailbox creator must still be an internal tenant owner/admin.

No existing mailbox is enrolled automatically. A missing/departed creator must be
reviewed before enrollment; the scheduler does not choose a different actor.

Mailbox row locks with SKIP LOCKED and the existing unique unfinished-discovery
index protect overlapping timers/replicas. The persisted query has a fixed upper
bound and the configured bounded lookback (default 14 days), including read mail.
Each new window repeats that lookback so indexing delays inside it remain visible;
provider-message identity uniqueness prevents duplicate imports/drafts. There is
no historical scan outside that window. Outages or provider indexing delays longer
than the configured lookback require an explicitly bounded staff reconciliation.

Scheduled windows drain all provider pages in recoverable claims of at most 100
identities each. At a claim budget boundary, the same job retains its frozen query
and cursor, releases its claim and becomes waiting. Its next claim resets the
per-page retry budget. It only completes when the provider reports no next page.
This avoids silently truncating a busy window at 100 messages. Manual Pull Latest
retains its existing bounded total. Failed discovery stays visible in the existing
import queue and blocks replacement until staff retry it; the scheduler never
silently discards failed work to advance a checkpoint. Large mailbox windows should
use an appropriate QA label/query and short lookback before a bounded pilot.

Canonical import recovery retains blacklist, tenant/account binding, attachment
completeness, durable evidence handoff and review safeguards. AI preparation and
Gmail acknowledgement keep their independent gates. This timer does not bypass
staff approval, create orders or change Gmail read/label state.

## Callback and QA mailbox readiness

Live authorized DEV API checks confirmed:

- Frontend callback still returns HTTP 200 HTML identical to the homepage.
- Backend callback with no valid state returns HTTP 302 to DEV mailbox settings
  with `inboundGmailError=invalid_state`; no application shell is returned there.
- The undeployed old reconnect start still generates the frontend callback URI
  and requests `gmail.readonly` (plus existing identity scopes).
- Railway's optional `GOOGLE_INBOUND_OAUTH_REDIRECT_URI` is unset. The committed
  callback fix will derive the correct backend URL from DEV's verified web origin.
  An explicit override may instead be set to exactly:
  `https://api-dev.printershero.com/api/inbound-orders/email/mailboxes/gmail/callback`.
- Google Cloud client management reached a “Verify it's you” password challenge.
  Authorized redirect registration and consent configuration remain unverified;
  interactive identity verification is a user handoff. Do not send credentials
  through chat. Preserve every existing authorized callback and MAIN configuration.
- The normal QA application login and tenant checks succeeded. There is one
  connected Gmail mailbox, disabled, with historical last success
  `2026-07-08T14:42:41.967Z`. This is not a live credential-health test, and the
  mailbox has not been established as a designated QA mailbox. It was not enabled,
  pulled, reconnected or modified.

A confirmed QA tenant/mailbox, Google redirect registration and a real same-account
modify-scope consent flow remain prerequisites. No operational mailbox may be
substituted merely because it is already connected.

## Disable/rollback and bounded acceptance

Before deployment/migration, retain `WORKERS_ENABLED=false`, empty all new
allowlists and leave every intake worker gate off. Preserve canonical migration
locking and startup failure behavior. Do not deploy a candidate which silently
skips migrations or needs a historical integrity bypass.

For a bounded QA run, first record every control's original value. Enroll only the
QA tenant/mailbox and a unique synthetic Gmail query/label with a short lookback.
Prevent unrelated workers from starting when lifting the global gate: explicitly
disable QuickBooks sync/queue, bulk invoice emails, reminders (including the legacy
reminder flag), payment reconciliation, thumbnails/asset preview and Prepress as
appropriate to their existing gates. Never rely on APP_ENV alone: this deployed
DEV backend runs NODE_ENV=production, whose worker defaults can be enabled.

After verifying migrations and the deployed frontend/backend revision, enable
only discovery/import, then AI preparation, then acknowledgement as acceptance
needs them. Mailbox `gmailAcknowledgementEnabled` must remain false until the
synthetic approval test. Reconnect/modify consent alone does not activate writes.
Do not use historical messages or reconcile legacy records during acceptance.

Exercise discovery without Import, actual attachment storage/downloads and AI,
edit preservation/stale approval, quote-only pending, duplicate rediscovery,
single Order creation with fresh API/database readback, covered-message-only
Entered/read, untouched newer replies, and deployed Neon recovery/fencing/retry.
Record each synthetic identity and resulting IDs privately in the QA evidence.
No customer notifications, label purchases, payment collection or accounting sync.

To stop: restore the global kill switch, disable each new worker gate, clear its
allowlists, disable QA mailbox enrollment and restore original intake settings.
Claims/outboxes remain durable for deliberate later recovery. An already-in-flight
Gmail operation cannot be recalled; inspect its immutable covered-message manifest
before any retry. Do not delete jobs, drop tables, rewrite a ledger or undo an
Order as a disable procedure. If code rollback is needed, restore the verified
previous DEV revision through the established deployment mechanism, retain additive
schema/history and keep all automation off. MAIN remains unchanged.

### Final observed controls for this preflight

`WORKERS_ENABLED=false`; all four intake worker gates and their tenant/mailbox
allowlists unset; callback override unset; existing Gmail mailbox disabled.
No control was changed and no provider write was attempted.

## Validation and acceptance status

- **114 real disposable PostgreSQL tests passed** (previous 107 plus seven
  discovery cases), including separate connections, existing crash/fencing and
  rollback suites. Gmail/AI/physical storage remain stubbed at their boundary.
- Scoped TypeScript over five changed source/test inputs passed, zero diagnostics,
  with the established 8 GB heap. No full build/typecheck was needed.
- Five migration comparison tests passed, covering conflicting identities, unchanged append-only
  history, changed SQL, retimestamping and a new migration behind DEV's frontier.
- Actual deployed Neon reads and target/ledger verification succeeded. No deployed
  transaction/worker-recovery or provider end-to-end acceptance has occurred.
- No new DEV deployment was initiated: Git migration compatibility is a release
  blocker. All shared schema/data and environment controls remain unchanged.

Remaining: reviewed migration reconciliation and baseline provenance/postconditions;
actual DEV migration compatibility/run; DEV frontend/backend revision verification;
Google management/redirect and test-mailbox consent; actual provider/storage/AI and
Neon transition/recovery acceptance; legacy reconciliation outside this test; final
bounded DEV acceptance and operational pilot enrollment review. Implemented code
does not establish rollout readiness.
