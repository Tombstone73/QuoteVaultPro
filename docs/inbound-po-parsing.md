# Bounded inbound PO parsing

## Reproduced failures and scope

A controlled signed-URL response sent PDF headers and never completed its body.
The original canonical read awaited fetch/arrayBuffer without a signal or deadline,
before the configured AI provider timeout could start. The UI POST/body had no
independent deadline. A second focused component reproduction completed the parse
POST but held queue/detail refetches forever: the success callback awaited those
background requests, leaving parsing active. These are confirmed source defects;
the specific document and processing stage of the reported MAIN attempt were not
available and have not been claimed as reproduced against MAIN.

A failed newest parse also disabled loading an existing saved staff draft and left
the shared workstation showing a permanent skeleton. Draft hydration and ordinary
editing now depend on the saved draft, independently of the newest AI result.
Missing AI suggestions remain absent; no historical values are invented.

## Existing path and bounded work

Attachment classification still updates canonical evidence and its fingerprint.
Parsing captures that fingerprint and saved classifications before external reads.
The existing evidence service and PDF.js extraction/fallback are retained. No OCR
service is added; image-only PDFs report that external OCR or manual source review
is required. Quarantined files are not read. Metadata-only/unresolved attachments
retain the existing incomplete-draft workflow and approval safeguards.

Work is bounded to 90 seconds across evidence, prompt, provider and candidate
resolution. Individual attachment reads use 20 seconds; extraction uses 15 seconds.
The configured provider timeout is retained with a 45-second maximum in this path.
Fetch/body reads receive cancellation, PDF loading tasks are destroyed, and an
independent promise deadline also handles adapters that ignore AbortSignal.
Failure persistence and readback each have a 15-second budget. The HTTP route is
bounded to 110 seconds, and browser request/body handling to 120 seconds. As with
other JavaScript timers, server deadlines require a responsive event loop; the
browser has its own deadline independent of server CPU or network progress.

A compact active status exposes Cancel Parse. Failure is visible above the
workstation with Retry Parse in Source Documents. Background refetches do not hold
the parse spinner. Error messages contain recovery steps, never raw provider,
storage, SQL or document exceptions. Provider/transport cancellation is best effort;
late values cannot resume the pipeline into result persistence.

## Concurrency, persistence and staff ownership

The existing tenant evidence lock serializes a bounded active parse operation in
record metadata. It is not a second draft store. Manual and automatic parsing use
the same operation identity. Completed attempts and their record/audit event are
persisted atomically through the canonical repository transaction; a replaced or
expired operation cannot publish successful results. Worker recovery can replace
an abandoned automatic operation only after the existing canonical queue claim
has established ownership of current evidence. It cannot replace a staff parse.
Only a hash of the worker fencing token is stored in operation metadata.

Cleanup clears only the same owned operation. Expiry permits recovery after a
process dies. Evidence changes retain the captured result fingerprint, keep source
review actionable, and require deliberate reconciliation. Parsing and Retry Parse
never create Orders. Existing staff drafts, source files, options, pricing,
customer linkage and workflow gates are retained.

Structured server logs use tenant/request/attempt IDs, attachment IDs, stage,
duration and safe failure categories. They contain no extracted text, document
contents, OAuth tokens, AI credentials or raw exceptions.

## Validation boundaries

Focused tests cover actual PDF text extraction, a PDF with no text layer, a real
loopback HTTP response with a stalled body, provider failure/timeout, cancellation,
late results, safe retry, duplicate exclusion, source changes and staff retention.
Disposable PostgreSQL verifies separate-connection claims, transactional rollback,
readback, tenant boundaries, worker death/recovery and unchanged saved drafts and
source references. No hosted database or customer order is used.

The local browser fixture exercises actual classification and editor components,
the real client deadline with a controlled clock, error/retry/cancel recovery,
background refetch stalls, retained edits, explicit reconciliation and both themes
at normal zoom. Its HTTP/provider/storage persistence is mocked, not a live DEV or
MAIN readback. No migration, worker activation, OAuth scope or Gmail mutation is
introduced. Deployed storage/provider behavior and the original MAIN document
remain live acceptance checks. No deployment verification is performed.


### Completed local checks

- Scoped TypeScript covers the affected runtime, adapters, fixtures and tests with
  `NODE_OPTIONS=--max-old-space-size=8192`; no full-codebase check is used.
- 174 focused server tests pass. Nine focused frontend cases pass. Frontend coverage includes client timeout/cancel,
  successful parse with stalled background refetch, retained saved drafts after a
  failed latest parse, malformed responses, and explicit reconciliation ownership.
- 14 distinct focused PostgreSQL cases pass across the initial focused run and a
  targeted recovery/fencing rerun. This includes 5 new bounded-PO cases and actual
  worker-process termination, separate connections and fresh persisted readback.
- Browser Save Draft failure, retry, synthetic reload and explicit reconciliation
  retain quantity 28. Real PostgreSQL separately retains the saved complete line
  payload, exact authorized override, staff notes and source-file associations.
