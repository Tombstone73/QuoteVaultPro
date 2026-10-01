# M7.8L Sales Workspace Contract Freeze

Base: `de345be8310c4aa8d8e6d483d61e70c24760379d`.
Scope: the user's approved Decision C, TEMP sales entry and transactional edit
sessions. Ownership remains solely governed by `V2_MODULE_OWNERSHIP_BOUNDARIES.md`.
This is an implementation contract, not another ownership constitution.

## Characterization

Five read-only tracks traced new entry, existing editing, Artwork, conversion,
and downstream side effects before this freeze. Existing `QuoteApplicationService.create`
and `OrderApplicationService.create` allocate permanent documents, lines, numbers
and audit/request records. Order creation additionally coordinates Billing,
Routing and material freeze. Existing Order updates already accept a combined
header/line change set, but UI operations commit separately. Artwork currently
requires canonical line identity. These are owner-controlled promotion targets,
not TEMP persistence primitives.

Canonical services can run on an existing transaction client through injected
transaction runners. Their failure envelopes MUST be converted to thrown errors
inside an outer promotion transaction. Existing Pool runners cannot be nested.
Quote Artwork assignment can advance Quote revision, so promotion returns the
final canonical reread. Order creation must retain deployed customer-agreement
pricing injection; Quote pricing must not silently acquire a different policy.

Current material-source dispatch, successor policies, issued-Invoice rules and
nonproduction fulfillment exemptions are not redefined by this program. Existing
financial/replay/locking research candidates are not blanket repair permission.

## Ownership and authority

Sales owns workspaces, TEMP lines, revision/CAS, promotion receipts and complete
TEMP-to-canonical line maps. Artwork owns staged binary claims, validation,
promotion/assignment and cleanup. Billing, Routing, Production, Prepress,
Fulfillment, Shipping and Auth retain their existing owner operations.

Initial staff surface: verified Staff principal, matching organization and exact
creator user. No cross-user browsing/editing or administrator wildcard. A neutral
new workspace requires existing `quote.create` OR `order.create`; promotion checks
the selected target capability and its existing override requirements afresh.
Artwork requires existing `artwork.adopt`/`artwork.assign` as appropriate. Reads
and replay must recheck workspace ownership; request keys never bypass authority.
Portal/AI entry and workspace sharing are not added implicitly.

## Sales persistence

Forward migration `0294_v2_sales_workspace_foundation.sql` creates:

- `v2_sales_workspaces`: text UUID id; organization; creator user; type
  `new_sales|quote_edit|order_edit`; state
  `draft|promoting|promoted|discarded|expired`; nullable source document/kind/base
  revision; positive workspace revision; bounded header JSON with typed domain
  validation; creation request identity/fingerprint; created/updated/expiry times;
  nullable promotion request/fingerprint, target, document identity and result.
- `v2_sales_workspace_lines`: stable TEMP UUID; tenant/workspace compound FK;
  position with scoped uniqueness; nullable source canonical line; typed input
  (Product, quantity, selections, dimensions, description, selling instruction),
  server-derived bounded preview/configuration evidence; revision/timestamps.
- `v2_sales_workspace_promotions`: one terminal receipt per tenant/workspace;
  unique tenant/request identity; target, document, input revision/fingerprint and
  result with complete durable TEMP-line to canonical-line mapping.

Bounded header fields: optional customer/contact, PO, job label, due date,
requested fulfillment, terms/notes supported by current Sales contracts. Empty
workspace/header is valid for draft persistence, not promotion. No permanent
Quote/Order number, document or line is allocated by workspace/line operations.
Job label must remain durable and must not be silently dropped on promotion.
Line identity is relational; a whole workspace is not one opaque JSON blob.

No edits to historical migrations. The coordinator alone owns journal/index and
integrity metadata. New tables have tenant-compound keys, scoped uniqueness,
positive revision and bounded payload constraints; no empty-IN construction.

## Workspace API

Public routes under `/v2/organizations/:organizationId/sales-workspaces` use the
existing verified principal and CSRF mechanisms. Create, read, list/resume,
update header, add/edit/delete/reorder TEMP lines and discard. Mutations use a
business request id plus expected workspace revision. The service locks the
workspace and applies one CAS revision per accepted mutation. Stale operations
return CONFLICT; ambiguous concurrent edits are never silently overwritten.
Resume by durable workspace id, not process/browser memory. Save Draft persists
without promotion. Discard is a tombstone/cleanup request, not canonical undo.

## Lines and preview

TEMP line validation and calculation call existing Products/Pricing services.
No UI or workspace copy of calculation rules. Preserve original input alongside
server evidence. Header customer changes invalidate dependent preview evidence.
Quote and customer-scoped Order pricing differ today; promotion must use the
selected owner's current service, not treat a Quote preview as guaranteed Order
pricing. Record expected Product/configuration/version/hash and calculated
target-price evidence; stale configuration or price returns an explicit conflict
requiring refresh rather than silently promoting a changed price. Overrides are
Sales instructions and require the existing target override capability.

## Artwork staging

Forward migration `0295_v2_sales_workspace_artwork.sql` adds Artwork-owned staged
claims keyed by tenant/workspace and nullable stable TEMP line. No Quote/Order
id is required. Reuse existing PDF checks, binary storage and upload ledger.
Do not use the legacy V1 finalize/adoption transaction as a TEMP upload API.
Upload retries use scoped business request identity and content fingerprint.

Storage I/O is outside the database transaction. Reserve a recoverable ledger
claim before writing bytes; successful staged ownership keeps those bytes live.
The existing reconciler must not delete bytes still claimed by a draft or a
promotion. Pending/failed upload states remain retryable or cleanup-pending.
Removing a line/file or discarding/expiring a workspace releases TEMP ownership;
cleanup runs only for unreferenced bytes after canonical/staged reference checks.
Storage deletion failure cannot erase evidence or create a canonical partial save.

Artwork promotion accepts the complete durable line map and the caller's
existing PostgreSQL client. It creates canonical owner assignments once and
records promoted identity on the staged claim. It must not modify Proofing or
mark Production ready. Historical and preexisting canonical Artwork is untouched.

## Promotion

One idempotent Sales operation: `promote(context, workspaceId, target, requestId,
expectedRevision)`. Lock and authorize workspace, validate nonempty complete
header/lines and expiry, and reserve a target/input fingerprint. `promoting` is
transaction-local; success, document/number allocation, all lines, durable
mapping, Artwork promotion, existing owner side effects and `promoted` receipt
commit together. A failure rolls them all back to an editable/retryable draft.
A replay returns the same receipt after fresh workspace authority checks.
Changing target/input under a reused request conflicts. Concurrent different
promotion requests cannot create two documents from one workspace.

For Quote: create only the canonical Draft Quote through the Quote owner, retain
pricing evidence, persist a count/order-validated complete line map, promote
Artwork, reread final revision. Do not send/accept it or create Order obligations.

For Order: call the current Order owner, retain client-line correlation, freeze
the current approved material/production evidence, and call existing Billing and
Routing ports in the same transaction. Do not directly write their tables or
create Production work, handoffs, shipments, payments or replacements.
Only existing durable outbox/queue behavior may be recorded; no external provider
request belongs inside TEMP editing or the promotion transaction.

## Existing edits and downstream policy

Types/source/base revision support future transactional edit sessions. Do not
expose a partially atomic edit action. D starts only after A/B/C contracts are
stable. Clone canonical input/evidence into TEMP without mutation; Cancel only
discards TEMP. Save must lock and compare base revision, compute the full change
set, call the current canonical owner, coordinate Artwork on the same client,
advance canonical revision once, and persist the receipt atomically.

Current source policy remains: material-bearing lines and routed lines have
existing edit/removal guards. Issued invoices are not universally immutable
current projections; preserve actual Billing rules, not stale comments. Combined
customer change plus line repricing currently uses old-customer policy: that
specific edit must remain blocked/deferred until deliberately implemented, not
silently forwarded. BDR-2/BDR-4-requiring edits remain explicit blockers.

## Expiry and recovery

Persist an explicit expiry (initial default 30 days) and creator attribution;
reject mutation/promotion of expired drafts. Reads/list and maintenance expose
expiry consistently. No indefinitely valid abandoned workspace. Discard/expiry
does not remove canonical documents. A failed transaction cannot leave committed
`promoting`; a committed promotion receipt is the sole replay truth. Storage
maintenance must use durable cleanup claims and retry safely. If no safe scheduler
can be supplied, record that operational worker as incomplete rather than claim
physical cleanup occurred. Do not deploy a destructive startup sweep.

## Awaiting Payment

Contract only until a separately approved financial-release policy: canonical
Order remains `open`; a financial owner condition may project `Awaiting Payment`.
No new persisted Order lifecycle enum or cosmetic status without release guard.
Terms, credit/exposure, override policy and point of production release remain
explicitly undecided. Entry and Proofing must not inherit an invented gate.

## Validation and package ownership

Coordinator owns this freeze, shared contracts, migration ordering/journal,
runtime/router composition, owner-API registrations, baseline review, and commits.
Separate builders own workspace foundation; line lifecycle/preview; Artwork
staging; promotion; and new UI components. No overlapping shared-file edits.
One independent test agent validates no canonical TEMP effects, persistence/reload,
tenant/user scope, stale revisions, durable maps, promotion replay/rollback and
cleanup failure. Every package requires focused tests and independent review.

Use embedded PostgreSQL (`@electric-sql/pglite`, dev dependency only) for actual
forward-DDL, constraints and transaction tests when a disposable PostgreSQL server
is unavailable. This is not a claim of live concurrency/provider validation.
Do not use ambient/shared database URLs. Canonical validation, UI build and
migration history integrity must pass before a completed milestone push to DEV.

## Reviewed implementation constraints

- Durable TEMP-line maps validate exact canonical tenant/document/line membership
  at insertion and promotion commit. Historical mapping IDs remain immutable,
  but do not add a perpetual FK veto to otherwise owner-authorized canonical
  line removal. Canonical Artwork history retains its existing deletion guards.
- Job label and workspace notes remain durable on the workspace and promotion
  receipt (`promotedWorkspaceHeader`). Canonical Quote/Order headers do not yet
  expose a dedicated job-label field; this is a presentation gap, not silent
  replacement of notes or a change to financial terms.
- Staging currently supports one active unlayered source PDF per TEMP line.
  Unassigned uploads must be assigned before promotion; duplicate Quote slots
  are rejected instead of replacing files silently. Expanded slots/formats are
  not part of this milestone.
- Cleanup is an explicit bounded maintenance operation, not an automatically
  deployed scheduler. Attempt-generation and settlement evidence keep uncertain
  writes eligible for rechecks. An unknown remote upload outcome cannot be
  declared settled merely because its DB session or process ended; outstanding
  uncertainty stays visible rather than falsely reporting no cleanup work.
- Existing Order/Quote edit workspaces remain reserved types, rejected by the
  public creation service until the full change-set and Artwork edit boundary
  is implemented. Existing canonical edit screens are not claimed transactional.
  The proposed payment-release contract is not an implemented financial gate.
