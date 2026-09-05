# M7.2D — V1 writer stop and drain map

**Scope:** source-only inventory of the V1/compatibility application at the M7.2D
baseline. It does not assert which optional processes are presently deployed. It
does establish every source-defined writer class that must be positively disabled,
drained, or rejected before the M7 reconciliation executor receives production
authority.

**Disposition:** **BLOCKED — no single write-free control exists in the V1
source.** `WORKERS_ENABLED=false` is a useful control for the in-process workers,
but it is not an HTTP maintenance gate and does not govern the standalone
prepress process. A production cutover must use an explicit ingress freeze plus a
verified process-by-process stop/drain manifest; it must not infer safety from one
environment setting.

## Source evidence and inventory boundary

`server/routes.ts` registers the V1 route modules and has no maintenance or
write-free middleware around their registration ([lines 343-535](../../server/routes.ts)).
This map covers every registered mutable domain module at the level at which it
can be stopped safely. The individual endpoint groups below are representative
paths from every cutover-critical domain, not a claim that unlisted `POST`,
`PUT`, `PATCH`, or `DELETE` paths are read-only.

| Authority / target state | Trigger and source evidence | Existing control and stop method | Drain / proof signal | Cutover disposition and residual risk |
| --- | --- | --- | --- | --- |
| **Staff and portal HTTP mutation plane** — commercial, operational, configuration, identity, and audit records | Route registration is centralized in [server/routes.ts:343-535](../../server/routes.ts). Core commercial mutations include quotes ([server/routes/quotes.routes.ts:740-2936](../../server/routes/quotes.routes.ts)), orders, lines, inventory and materials ([server/routes/orders.routes.ts:2169-9356](../../server/routes/orders.routes.ts)), products ([server/routes/products.routes.ts:407-2439](../../server/routes/products.routes.ts)), customers/relations/users/organizations, catalog/pricing, imports and procurement (registered at [server/routes.ts:487-535](../../server/routes.ts)). | Authentication and tenant middleware authorize callers, but are **not** a maintenance gate. Stop by removing public mutation ingress / routing traffic and rejecting all non-safe methods at a verified edge or application gate. | A synthetic authenticated mutation must return a deterministic maintenance rejection; active HTTP requests must reach zero before reconciliation. The source has no counter or assertion for that state. | **STOP AND DRAIN. P0.** A source-level cutover gate is required or an externally enforced method/path denylist must be demonstrated. Do not rely on operator memory or CORS. |
| **Customer portal mutations** — profile, customer uploads, proof/quote decisions, Stripe intents | [server/routes/portal.routes.ts:326-369](../../server/routes/portal.routes.ts) exposes profile, payment, file, proof, and quote actions; token proof action is separately public at [server/routes/portalProof.routes.ts:294](../../server/routes/portalProof.routes.ts). | Portal authentication/token validation is not a cutover stop control. Stop at ingress alongside staff routes; invalidate/hold external callbacks only after durable receipt policy is chosen. | Probe the portal mutation paths with a non-destructive authenticated/test request in a rehearsal; all must reject before the database executor starts. | **STOP AND DRAIN. P0.** Public token route makes an ingress-only staff-session freeze insufficient. |
| **Artwork, uploads, thumbnails, previews, and file adoption** — object/file rows and external object storage | Upload/finalize/delete and artwork allocation routes are in [server/routes/attachments.routes.ts:285-2698](../../server/routes/attachments.routes.ts); operational artwork promotion and file actions are in [server/routes/orders.routes.ts:4176-6742](../../server/routes/orders.routes.ts). Background thumbnail behavior is in [server/workers/thumbnailWorker.ts:493-572](../../server/workers/thumbnailWorker.ts); asset previews in [server/workers/assetPreviewWorker.ts:17-75](../../server/workers/assetPreviewWorker.ts). | In-process workers observe `isWorkerEnabled`; route-driven uploads can still trigger work while ingress is open. `stopThumbnailWorker` / `AssetPreviewWorker.stop` exist but are not called by server signal handling. | Stop new upload/adoption ingress, stop workers, then prove queue/trigger buffers and active promise state are empty. Existing code exports no joined shutdown/drain result. | **STOP AND DRAIN. P0.** Storage/provider side effects must be held; no copied production storage credentials in rehearsal. |
| **Standalone prepress worker** — `prepress_jobs`, reports, outputs, scratch cleanup | Production entrypoint is `npm run prepress:worker` ([package.json:153-154](../../package.json)); it starts polling and cleanup directly ([server/prepress/worker/main.ts](../../server/prepress/worker/main.ts)). Claim is now one oldest queued row using `FOR UPDATE SKIP LOCKED` ([server/prepress/worker/processor.ts](../../server/prepress/worker/processor.ts)). | **No `WORKERS_ENABLED` check exists in this standalone entrypoint.** The dev correction in `pollerController.ts` closes admission and awaits bounded active-work drain on SIGINT/SIGTERM. | A timeout exits nonzero and retains the durable running claim for the manifest; it never bulk-resets or blindly retries work. This needs deployment and live proof before it can establish PROD safety. | **STOP AND DRAIN — source correction complete; live proof remains P0.** Stop standalone process separately, require a successful drain result, and treat timeout as a failed cutover gate. |
| **In-process prepress** — same prepress queue | It is explicitly gated by both `WORKERS_ENABLED` and `PREPRESS_WORKER_IN_PROCESS` in [server/index.ts:244-260](../../server/index.ts); lifecycle functions only stop polling/cleanup ([server/prepress/worker/in-process.ts:20-53](../../server/prepress/worker/in-process.ts)). | `WORKERS_ENABLED=false` prevents startup. Existing instances need application process stop; no server SIGTERM handler invokes `stopInProcessWorker`. | Same active-pipeline gap as standalone prepress. Verify disabled configuration before start and zero active claims before migration. | **STOP AND DRAIN. P1** once standalone prepress fix supplies reusable drain semantics; until then treat as P0 if enabled. |
| **Production and fulfillment lifecycle** — production jobs/runs, station progress, material use, handoff/shipment/pickup | Production job mutations are in [server/routes/productionJobs.routes.ts:3135-4353](../../server/routes/productionJobs.routes.ts), run mutations in [server/routes/productionRuns.routes.ts:185-362](../../server/routes/productionRuns.routes.ts), prepress/production transfer in [server/routes/prepress.routes.ts:2483-3429](../../server/routes/prepress.routes.ts), fulfillment in [server/routes/fulfillment.routes.ts:126-555](../../server/routes/fulfillment.routes.ts). | HTTP-auth only; no shared maintenance control. | Drain active staff requests; snapshot every in-flight production/fulfillment record with owner, state, outstanding work and rollback disposition. | **STOP AND DRAIN. P0.** Never mass-reset or blindly replay the 191 in-production orders / queued work. |
| **Stripe payment ingress and reconciliation** — webhook receipt, payments/invoices/refunds | Stripe webhook is a public `POST` at [server/routes/mvpInvoicing.routes.ts:1232](../../server/routes/mvpInvoicing.routes.ts); the route also allows Stripe intent/confirmation, manual payments, invoices, sends, and reconciliation ([lines 533-2745](../../server/routes/mvpInvoicing.routes.ts)). `captureAndApply` persists an observation and applies local financial state ([server/services/stripePaymentReconciliationService.ts:126-220](../../server/services/stripePaymentReconciliationService.ts)). A periodic reconciliation loop starts in [server/index.ts:382-402](../../server/index.ts). | Periodic reconciliation follows `WORKERS_ENABLED`; webhook ingress and operator routes do not. | Decide/implement maintenance behavior: authenticated webhook receipt may be durably captured without applying business state, or external ingress must be held/replayed. Prove no received event is processed during reconciliation. | **STOP AND DRAIN / MUST SNAPSHOT. P0.** Payment state is cutover-critical; no provider event should be dropped, processed twice, or silently applied after the boundary. |
| **QuickBooks pull/push and financial queues** — external accounting plus local queue state | Autonomous sync processor is [server/workers/syncProcessor.ts:1-160](../../server/workers/syncProcessor.ts); ownership policy reserves `queue` for V2 by default ([server/workers/quickBooksWorkerOwnership.ts:1-47]). Server starts QB workers/timer only with credentials and worker gate ([server/index.ts:262-345](../../server/index.ts)). Direct operator push/pull/flush/import routes remain available ([server/routes/quickbooks.routes.ts:123-623](../../server/routes/quickbooks.routes.ts)); invoice/payment QB actions exist at [server/routes/mvpInvoicing.routes.ts:1832-2024](../../server/routes/mvpInvoicing.routes.ts). | `WORKERS_ENABLED=false` stops startup of the in-process loops but not direct routes. Queue timer has no exported stop/drain handle in `server/index.ts`. | Stop provider-facing routes and worker owner; snapshot pending/claimed/failed operations, provider IDs, and last successful projection. Do not re-run uncertain external writes automatically. | **STOP AND DRAIN / MUST RECONCILE AFTER START. P0.** The source supports owner selection but not a complete shutdown acknowledgement. |
| **Invoice, quote, proof, shipping and reminder email** — external email plus local audit/delivery state | Direct quote/order email routes: [server/routes/email.routes.ts:112-478](../../server/routes/email.routes.ts). Invoice send/reminder paths: [server/routes/mvpInvoicing.routes.ts:2431-2745](../../server/routes/mvpInvoicing.routes.ts). Proof send/respond/cancel paths: [server/routes/proofing.routes.ts:291-1158](../../server/routes/proofing.routes.ts). Reminder loop starts when enabled ([server/index.ts:347-380](../../server/index.ts)); it sends externally and writes logs ([server/invoiceReminderJob.ts:1-18](../../server/invoiceReminderJob.ts)). | Reminder loop is gated (`WORKERS_ENABLED` through `isWorkerEnabled`, except explicit legacy opt-in); direct sends are not. | Disable routes and timers; record scheduled/in-flight delivery attempts and use provider-attempt evidence before intentional retry. | **STOP AND DRAIN / MUST RECONCILE AFTER START. P1.** Provider delivery is not exactly-once; preserve ambiguity rather than resend. |
| **Payment provider/EPS routes** — hosted sessions, sales, refunds, capture, batch close | [server/routes/paymentProvider.routes.ts:154-221](../../server/routes/paymentProvider.routes.ts) has direct provider mutation endpoints. | Auth and role checks only; no maintenance control. | Reject all provider mutation calls in the gate; capture open hosted sessions and outstanding payment operations. | **STOP IMMEDIATELY, then reconcile. P0.** Provider calls cannot safely be allowed during schema authority handoff. |
| **Imports, inbound orders, scheduled/queued AI and lifecycle work** — create/update data from queued or route-driven work | Inbound/import/job modules are registered at [server/routes.ts:462-532](../../server/routes.ts). AI review and triage queues schedule an asynchronous drain at [server/services/ai/aiReviewQueue.ts:1-37](../../server/services/ai/aiReviewQueue.ts) and [server/services/ai/aiTriageBriefQueue.ts:1-37](../../server/services/ai/aiTriageBriefQueue.ts). | No inventory-wide gate or process drain contract found. Route auth is not sufficient. | Inventory all deployed queue consumers and their in-flight work; stop acceptance, then classify each job as drained, released, or snapshot-required. | **UNKNOWN / BLOCKER (P0 until runtime inventory proves otherwise).** Source defines asynchronous drains but no cutover ownership signal. |
| **Assistant execution / automation command plane** — quotes, orders, CRM, product, production, fulfillment, billing and payment commands | Command registry binds mutating execution commands at [server/routes/assistantExecution.routes.ts:207-230](../../server/routes/assistantExecution.routes.ts), and confirmation endpoints are registered at [lines 257-495](../../server/routes/assistantExecution.routes.ts). | Route auth/tenant scope and command confirmations exist, but no maintenance gate is visible. | Deny confirmation/execution endpoints; inspect persisted plans that are confirmed/ready and prevent deferred execution. Verify no worker or external MCP endpoint invokes the same services. | **STOP AND DRAIN. P0.** This is a demonstrated in-app mutation authority. |
| **MCP / externally hosted automation runtime** — unknown backend authority | No `mcp` server registration or process configuration appears in the repository search. This absence is not evidence that a separately deployed MCP process cannot call the V1 API or database. | No source control or stop method established. | Read-only infrastructure inventory must identify each MCP endpoint, target backend, credentials/scopes, registered mutation tools, and deployment stop control. | **UNKNOWN / BLOCKER (P0).** M8 is prohibited until this is resolved or an enforced boundary prevents every MCP mutation path. |
| **Automatic migration startup / deployment hooks** — DDL and ledger writes | V1 server calls `runMigrations()` before routes/worker startup ([server/index.ts:130-136](../../server/index.ts)); its emergency kill switch is `DRIZZLE_AUTO_MIGRATE=0` ([server/runMigrations.ts:490-508](../../server/runMigrations.ts)). Railway predeploy invokes `npm run v2:migrations:apply` ([railway.json:3-7](../../railway.json)). | Set/verify migration startup disabled on every V1 process and prohibit deployment/predeploy during the maintenance window. The M7 reconciliation executor remains the sole schema writer. | Capture deployed revision/process list and prove no migration runner connection/lock exists other than the executor. | **STOP IMMEDIATELY / SINGLE EXECUTOR. P0.** This is a DDL race otherwise. |

## Required writer-stop sequence

This is a required runbook shape, not an assertion that V1 implements it today.

1. Enter a durable maintenance boundary that rejects every V1 staff, portal,
   token, webhook-application, assistant-execution, and provider mutation path.
   Health/readiness and explicitly read-only administration may remain available.
2. Stop external ingress or change it to durable receipt-without-application only;
   record the chosen Stripe/email/provider replay policy before the window.
3. Stop all application replicas after verifying `WORKERS_ENABLED=false` for any
   replacement/restart. Explicitly stop standalone prepress separately; it is not
   governed by the environment gate.
4. Wait for a bounded drain and produce an immutable per-authority manifest:
   active HTTP, prepress claimed work, production/fulfillment operations, provider
   queues, email attempts, accounting operations, assistant plans, and schedulers.
   Each item is `DRAINED`, `SAFE_TO_FREEZE`, `MUST_FINISH`, `MUST_RELEASE`,
   `MUST_SNAPSHOT`, or `MUST_RECONCILE_AFTER_START`.
5. Machine-check the gate: all mutable HTTP probes fail closed; all autonomous
   owners are stopped; no active claims remain unless explicitly manifested; no
   migration runner owns its advisory lock. Only then grant the reconciliation
   executor its single schema-writer authority.
6. Start V2 read-only surfaces and smoke checks first. Release lifecycle writers,
   operational workers, delivery workers, financial/provider workers, external
   ingress, and customer mutations one group at a time with a recorded success
   signal. Do not release an authority with an unresolved manifest item.

## Restart and rollback rules

Before V2 has accepted authoritative writes, a V1 restart requires the same
compatibility-schema smoke check performed against a clone plus the preserved
manifest. If reconciliation/attestation failed, use a forward repair or clone
restore decision based on the reconciliation ledger; do not restart V1 into an
unknown partial stage. After any V2 authoritative write, rollback is a
forward-reconciliation decision, not an automatic V1 restart.

## Findings requiring implementation or runtime proof

- **P0:** deploy and live-prove the bounded graceful shutdown/drain correction
  for the standalone prepress worker; source tests alone do not establish PROD control.
- **P0:** establish one machine-checkable maintenance/write-free gate covering
  all HTTP/portal/token/assistant/provider ingress, plus a deployment process
  inventory that proves no independent writer remains.
- **P0:** resolve MCP/externally deployed automation authority with read-only
  runtime evidence.
- **P1:** give every server-started timer a registered shutdown/drain signal;
  the QuickBooks, reminder, and reconciliation timer handles are local to the
  startup closure.
- **P1:** rehearse webhook receipt/hold/replay and external delivery ambiguity on
  a disposable clone without provider writes.
