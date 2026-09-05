# M7.2B V1 handoff plan

## Status: design only — no production process was stopped or reconfigured

## Non-negotiable writer rule

Exactly one authority may write each domain. Do not start a V2 writer until the corresponding V1/API/worker/cron/MCP/external writer is proven stopped or retained behind an explicit compatibility boundary. Unknown ownership is a failed gate, not an assumption.

## Stop, drain, and start sequence

1. Name one release commander and one direct migration executor. Verify immutable artifact SHA, clone evidence, restore authority, direct database target, and timeboxed abort decisions.
2. Enter maintenance at outer traffic boundaries: customer UI/API, Vercel proxy/domain, Railway domain, MCP ingress, webhooks, schedulers, and direct mutation endpoints. Maintenance must reject writes, not merely hide UI.
3. Freeze writer admission. Disable V1 in-process workers and every explicit worker gate. WORKERS_ENABLED=false does **not** stop scripts/prepress-worker.ts; separately identify and stop/scale down/disable all standalone prepress launchers, cron, worker dynos, MCP and external automations.
4. Wait only for already admitted, identified HTTP/provider transactions to settle; do not permit a new claim. Capture a final aggregate queue/session snapshot.
5. Stop V1 API or leave only an explicitly read-only maintenance image with automatic migration disabled and all workers absent. Prefer no app connection during DDL.
6. Run the sole pre-Drizzle reconciliation executor, then normal Drizzle only after reconciliation postconditions pass.
7. Start V2 API in maintenance/read-only smoke mode with migration capability and workers disabled. Verify catalog probes without writes.
8. Start V2 writers one class at a time: derived assets, internal operational workers only with a proven atomic claim, email, financial local outbox, Stripe local reconciliation, and QuickBooks/provider sync last. Reopen ingress only after each class passes its owner/idempotency/queue gate.

## Domain handoff matrix

| Domain | Last safe V1 write / stop condition | Drain and handoff | V2 start / rollback condition |
| --- | --- | --- | --- |
| Orders, quotes, CRM, catalog | completed request transaction before maintenance; close all mutation admission | preserve ID/org/status/event timestamps and mapping totals | V2 only after compatibility/state translation passes; V1 resume only while no incompatible V2 state exists |
| Artwork, uploads, proofs, assets | stop upload/finalize/promotion and thumbnail/preview work | wait for terminal copy/preview evidence or mark pending; hand off object key/checksum/reference, not copied binaries | start after storage/reference/lifecycle reconciliation; V1 semantics retained on rollback |
| Production, prepress, fulfillment | stop transitions, inventory reserve/release, both prepress launcher forms | freeze and manifest the 191 in-production orders and 320 queued jobs | start only after per-record mapping and atomic one-row claim are clone-proven; unknown jobs block automatic start |
| Billing, payments, Stripe/EPS | close create/capture/refund/void and stop local recovery only after ingress decision | preserve invoice/payment/provider/event IDs and durable signed observations | provider writers last; no provider rollback, only forward reconciliation or compatible V1 resume |
| QuickBooks/accounting/outbox | stop legacy sync and queue; do not process failed work as a drain | snapshot pending/failed/eligible work and leases | one owner only after lease/idempotency mapping; queues remain frozen on rollback unless exact V1 compatibility proven |
| Email/reminders/delivery | stop scheduler, manual endpoints, and queues | snapshot unsent/attempting/failed and known provider message IDs | no blind retry of attempting/unknown sends; start only after delivery-state mapping/idempotency |
| MCP/automation | enumerate executable tool/process/inbound paths then disable all mutation authority | no assumption permitted | remains disabled until tool allowlist, auth, kill gate, and audit evidence pass |

## Prepress defect handling

The V1 poller can update all queued rows to running while handling only the first result. SIGTERM stops future polling but does not await active processing, so a claimed job can retain partial external output while remaining running. Do not use queued/running counts as a drain criterion. Build a per-job manifest: legacy ID, org, order/line, observed state, heartbeat/execution evidence, output references, disposition, and ambiguity reason. Never bulk reset running to queued; unresolved records require manual adjudication.

## Migration control and gates

V1 invokes runMigrations before routes/workers. Default behavior is enabled unless DRIZZLE_AUTO_MIGRATE is exactly 0 or false; disabling it also skips release checks. The current runner chooses MIGRATION_DATABASE_URL, then DIRECT_DATABASE_URL, then DATABASE_URL and uses bounded session advisory lock 928372001. During cutover, freeze both V1/V2 auto-migration and run an independent schema verifier alongside the single direct reconciliation executor.

Gate 1: all V1/external writers and active claims proven stopped. Gate 2: clone/restore provenance verified. Gate 3: one direct migration executor obtains lock. Gate 4: reconciliation catalog postconditions pass. Gate 5: mapping and exception manifests reconcile, including 191/320. Gate 6: V2 read-only smoke has no implicit migration. Gate 7: V2 workers remain off. Gate 8: controlled per-domain writer release. Gate 9: public reopen only after financial/provider queue integrity.

## Rollback / abort

Before schema work: remove maintenance only after writer inventory is stable and resume V1 alone. During additive schema/backfill: preserve compatibility schema and forward-fix; use V1 only if probes prove it remains compatible. After destructive semantics or V2 writes: freeze writers; do not downgrade blindly. Use a named-authority restore/branch plan or forward repair based on exact stage. Provider side effects cannot be undone, which is why provider writers start last.
