# M7.2C V1 handoff gate report

## Status: design and source-path validation only

No V1 process, production runtime, provider, or database was started or changed for this report. The future handoff remains blocked until its live stop/drain evidence is captured during the approved cutover window.

## Source evidence

| Finding | Source path | Consequence |
| --- | --- | --- |
| V1 API launches the in-process prepress worker only when `PREPRESS_WORKER_IN_PROCESS=true` and `WORKERS_ENABLED` is not explicitly false. | `server/index.ts` | `WORKERS_ENABLED=false` controls this in-process launch path. |
| The standalone entrypoint `npm run prepress:worker` directly calls `startWorker()`; it has no `WORKERS_ENABLED` gate. | `scripts/prepress-worker.ts`, `server/prepress/worker/main.ts` | Every standalone launcher/dyno/cron must be found and stopped independently. |
| On SIGTERM the standalone worker calls `stopPolling()`, `stopCleanup()`, logs completion, and calls `process.exit(0)` without awaiting an active `processOneJob()`/pipeline. | `server/prepress/worker/main.ts`, `server/prepress/worker/poller.ts` | A job marked `running` can have incomplete or externally persisted output after shutdown. It must not be reset or replayed automatically. |
| A claim changes a queued row to `running`, then the pipeline may generate outputs and subsequently mark it succeeded or failed. | `server/prepress/worker/processor.ts` | Queue counts alone are insufficient to establish a drained state. |

## Required handoff sequence

1. Enter a maintenance/write-admission gate outside the V1 UI/API, webhooks, schedulers, MCP, and direct mutation paths.
2. Disable V1 in-process workers and separately stop every standalone worker, including the standalone prepress launcher.
3. Capture a read-only final manifest after admission closes. It must cover orders, production jobs, invoices, payments, provider queues, and delivery queues; current counts are observations, never hardcoded targets.
4. For every claimed or unknown prepress/worker record, capture available heartbeat, execution, and output references and set `manual_adjudication` or `retain_v1`. Never bulk-reset running work to queued.
5. Run the sole reconciliation executor only after the manifest and all writer-stop evidence pass. Start V2 read-only with workers disabled; release writers one authority class at a time.

## Manifest contract

`v2/src/modules/prepress/handoffManifest.ts` supplies a pure, side-effect-free contract and validator. It represents the required authority, state, obligation, claim/execution evidence, output references, provider state, handoff disposition, expected V2 state, and rollback disposition.

The validator fail-closes on duplicate records, an invalid capture, an active/unknown claim sent to V2, missing expected V2 state, and provider/delivery releases that lack both an observed provider state and an idempotency reference. It permits ambiguous records only as explicit `manual_adjudication` with a reason.

`v2/tests/modules/handoffManifest.pure.ts` exercises the normal release, active-claim block, manual-adjudication path, external-delivery idempotency block, and duplicate-record block without connecting to any service.

## Remaining live gate evidence

- An operator-owned inventory proving every Railway/cron/standalone/MCP/provider mutation process is stopped.
- A cutover-window manifest captured after writer admission closes, with fresh source fingerprint and per-record records.
- An explicit disposition for claimed/unknown prepress work, including any partially emitted files.
- Independent proof that V2 starts with no migration or worker authority and remains read-only before controlled writer release.

## Disposition

**PASS WITH FINDINGS for source-level manifest design; NOT a production handoff approval.** The standalone prepress shutdown behavior is a P0 cutover gate until a live manifest and explicit stop/drain proof exist.
