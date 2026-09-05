# M7.2E runtime authority map

> Superseded for cutover use by M7.2F: authenticated Railway inventory subsequently found a separate live `prepresshero` production worker project. See `M7_2F_RUNTIME_AUTHORITY_FINAL.md`.

## Disposition: BLOCKED — live V1 writer confirmed; external MCP/Vercel authority unresolved

Authenticated Railway read-only inspection found one `PrintersHero-PRODUCTION` project/environment service, one running replica, no Railway cron service, and a successful deployment of `main` revision `1326ad1` (2026-09-04). It exposes the production API and object domains. The deployment log records the in-process asset-preview worker actively processing pending assets, so V1 is demonstrably capable of writing operational/storage state now. This is not a cutover action; nothing was stopped or changed.

| Writer authority | Source/runtime shape | Stop mechanism required | Required stop proof | Classification |
| --- | --- | --- | --- | --- |
| V1 HTTP, portal, token and assistant mutations | The one live V1 API service exposes the production API domain; registered routes have no maintenance middleware (`server/routes.ts`). | Close mutable ingress, then stop the single V1 API replica. | Edge mutation probe rejects; Railway service/replica inventory says stopped. | STOP WITH V1 — P0 |
| Thumbnails and asset previews | API process starts them by default (`server/index.ts`). | Stop V1; future restart uses `WORKERS_ENABLED=false`. | All replicas exited; no active worker operation. | STOP WITH V1 — P0 |
| In-process prepress | Only enabled by `PREPRESS_WORKER_IN_PROCESS=true` and worker gate. | Stop V1, verify flag disabled before any restart. | Process exit and zero claimed jobs. | STOP WITH V1 — P1/P0 if enabled |
| Standalone prepress | Independently launchable as `npm run prepress:worker`; bypasses `WORKERS_ENABLED`. Railway has no separate service or cron, but an in-container launcher cannot be excluded from read-only topology alone. Deployed `main` predates M7.2D drain fix. | Prove absent or stop it separately after promoting bounded drain behavior. | SIGTERM drain exit 0; timeout is gate failure. | STOP SEPARATELY — P0 |
| Production/fulfillment/inventory routes | Direct V1 HTTP mutations. | Same ingress freeze and V1 stop. | Edge rejection and request drain. | STOP WITH V1 — P0 |
| Stripe webhooks and payment routes | Public webhook plus direct payment endpoints; reconciliation timer is worker-gated. Production Stripe credential variable names are configured. | Stop V1 consumer; hold/record external delivery policy. | Provider retry/endpoint policy plus stopped consumer evidence. | EXTERNAL INGRESS MUST HOLD — P0 |
| QuickBooks sync/queue and direct routes | In-process timers are gated; direct push/pull/flush routes are not. Production QuickBooks credential variable names are configured. | Stop V1 and hold admin mutation ingress. | Railway process evidence and queue/claim snapshot. | STOP WITH V1 — P0 |
| Email, proof, quote, invoice and reminders | Direct send routes remain available; reminder timer is opt-in. | Stop V1 and close mutable/email-send ingress. | Process stop and pending/ambiguous delivery report. | STOP WITH V1 — P1 |
| Financial outbox | Worker/process ownership is not established by deployment metadata. | Stop its actual consumer, if any. | Process inventory and queue/lease snapshot. | UNKNOWN / BLOCKER — P0 |
| V1 automatic migration and Railway predeploy | V1 calls `runMigrations()` before routes; `railway.json` has `v2:migrations:apply` predeploy. | No V1 start/deploy during window; only reconciliation executor gets schema authority. | No migration lock/session; deployment freeze recorded. | STOP SEPARATELY — P0 |
| MCP PROD and DEV | No MCP service, tool registry, backend target, or authentication config exists in source. | Identify and stop/disable each mutation-capable MCP independently, or prove no mutation authority. | Read-only registry, target, tool, auth and process inventory. | UNKNOWN / BLOCKER — P0 |
| V2 workers | V2 starts QuickBooks, invoice-email and proof-email workers after listen unless specifically disabled; current config permits only DEV Railway. | Do not start V2 writers until attestation/readiness succeeds. | V2 service absent/stopped during reconciliation. | STOP SEPARATELY — P0 |
| Reconciliation executor | Direct database-only process. | Never run more than one executor. | Durable lock and attempt-ledger read-only observation. | SINGLE EXECUTOR — P0 |

## Actual topology findings

- Railway identifies exactly one production service, one running replica, no cron schedule, Railpack build, and no configured start-command override. Its deployed branch is `main`, not the V2 `dev` worktree.
- The configuration's redacted variable-name inventory contains Stripe, QuickBooks, Supabase and Google credentials but does not contain `WORKERS_ENABLED`, `PREPRESS_WORKER_IN_PROCESS`, `DRIZZLE_AUTO_MIGRATE`, or any V2 delivery-disable name. With the V1 source defaults, asset preview, thumbnails and payment reconciliation are eligible to start; the live log positively confirms asset preview is active.
- The V1 process starts migrations before routes and supported in-process workers after listen. Railway's single-service topology means stopping this replica stops those in-process writers, but only after a fresh stopped-replica observation.
- The standalone prepress entrypoint is separate in source. The deployed `1326ad1` main revision has the old SIGTERM handler (`stopPolling(); process.exit(0)`) rather than M7.2D's awaited bounded drain. A pre-cutover promotion/live proof is mandatory if such a process exists.
- Vercel project/domain configuration and any external MCP deployment remain unobserved. No maintenance ingress control exists in checked-in source.
