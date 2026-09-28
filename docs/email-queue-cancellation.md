# V1 email queue cancellation and supersession

Starting point: clean `main` at `efdc9a4a11278d7479323eefb6eacbc700ac5afc`.

## State-machine audit

The shared durable worker stores Invoice and Statement jobs in `invoice_email_delivery_jobs`. `queued` is displayed as Waiting; there is no separate waiting database state. Claims use a conditional update under `FOR UPDATE SKIP LOCKED`, one job per minute. `queued` / `retrying` become `processing`. Provider success becomes `sent`; safe failure becomes `retrying` until the attempt limit, then `failed`. Expired processing leases return to retrying before the provider boundary, or `needs_review` after it. A reviewed needs-review row becomes failed, optionally with a new explicitly linked replacement job. Failed is terminal; sending again is a new request.

`canceled` already existed in the status CHECK constraint and types, but had no staff action. Migration 0215 adds `superseded` to that constraint without changing any rows. Both are terminal; claim, scheduling, recovery and active counts remain positively restricted to their existing active statuses. Review replay rejects both terminal outcomes.

Cancellation atomically updates only queued/retrying/needs_review in the authenticated organization. Processing/sent/failed/superseded are skipped; already canceled is an idempotent no-op. JSON metadata is merged with cancellation timestamp, principal and optional reason, preserving message/document evidence and failure history. Provider-boundary entry rejects a job that is no longer processing; later worker writes require the owned processing claim. Cancellation of needs_review stops future attempts but cannot recall an uncertain prior submission.

## Send identity and snapshots

Campaign idempotency keys identify an operator request. The job hash identifies Invoice/version/normalized recipient and is reused for separate resends, so it is not sufficient intent evidence. `retryOfNeedsReviewJobId` / `deliveryReview.replacementJobId` are explicit replacement lineage. Subject/body are frozen in job metadata for new sends. Invoice jobs retain Invoice version but do not freeze PDF bytes at enqueue; Statement jobs reference immutable snapshots with stored PDF bytes. This task does not alter either document mechanism.

Automatic supersession is Invoice-only and requires a later sent job with a provider message identifier, the same organization, document, normalized recipient key, version and exact frozen subject/body, plus either the same campaign or an explicit replacement link. Missing legacy content, changed versions, unrelated resends and different recipients are not inferred equivalent. The old row must be queued/retrying. Reconciliation runs after successful queue delivery and under the pre-claim row lock. No processing or needs-review job is automatically superseded. Statement behavior is retained.

Legacy Invoice logs contain recipient/time/provider ID but no request or frozen-content lineage. A later log alone cannot mark a job sent or superseded. At worker recovery it holds the ambiguous job for review, preventing an uncertain duplicate.

## Read-only historical inspection

`GET /api/invoices/email-queue/reconciliation?invoiceId=<id>` uses the existing admin/tenant authorization and is always dry-run. It reports old job identity, recipients, enqueue time, version, frozen content, replacement evidence and later send logs. There is no historical apply endpoint.

MAIN browser inspection on September 28, 2026 verified Invoice 20395 (`a3c902e4-1c12-4194-919c-31274837aa4d`): retrying to `pkpromos@gmail.com`, queued September 20 at 7:19 PM, with a pre-provider expired-claim failure. The Invoice timeline records a successful email to the same address September 21 at 8:46 PM, and an intervening commercial snapshot change September 21 at 11:28 AM (times as displayed in the browser). The UI does not expose the queue ID, frozen subject/body, version, replacement lineage or provider identifier. The available Supabase production project does not contain the application's Invoice queue tables; no local MAIN database connection was available. Therefore safe supersession is **not proven**, and no claim is made that the dry-run utility identifies 20395 as safe. The regression fixture verifies that these incomplete facts are insufficient. MAIN was not mutated.

## Validation

Production build passed and packages migration 0215. Focused tests: 67 server/shared and 33 frontend passed, including worker state predicates, provider-boundary rejection, cancellation conflicts, review replay guards and message preservation. Service tests use mocked persistence; they are not database-backed concurrency tests. TypeScript reports 244 pre-existing diagnostics versus the 246 starting baseline; the queue DTO fixes two existing missing-deliveryType diagnostics, with no new task-attributable diagnostics. Local Chrome validation used mocked APIs and verified single/bulk confirmation, reasons, active-count refetch, active removal, canceled/all history, sent/processing protection and Superseded presentation. DEV and live MAIN behavior were not validated; migration was not applied during source work.
