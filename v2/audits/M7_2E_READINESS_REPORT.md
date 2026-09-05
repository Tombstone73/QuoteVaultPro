# M7.2E readiness report

## Disposition: BLOCKED

M7.2E implemented and tested a fail-closed write-free runtime gate and completed source/runtime discovery without production mutations. Authenticated Railway read-only inspection establishes a single, live V1 production replica. Its logs show the asset-preview worker actively running, so production is not write-free and the gate cannot pass now.

## Proven

- Railway has one production service, one running replica, no Railway cron, and a successful `main` deployment (`1326ad1`).
- V1 source has broad HTTP mutation authority and automatic migration startup; the live deployment is running the asset-preview worker.
- `WORKERS_ENABLED=false` is not a complete cutover control.
- Standalone prepress is independently launchable and requires a separate bounded drain proof. The deployed `main` revision does not include M7.2D's awaited graceful-drain correction.
- The gate requires fresh, source-specific evidence for V1/V2 writers, migration/executor ownership, provider ingress, and MCP PROD/DEV.
- Root checked-in Vercel rewrites point to the DEV API, not evidence of production routing; no maintenance rewrite is defined in source.

## P0 blockers

1. Verified V1 maintenance ingress control and write-free process/drain evidence after the single replica is stopped.
2. Promote and live-prove the standalone-prepress bounded shutdown correction, or prove no standalone launcher exists.
3. MCP PROD/DEV registry, backend target, mutation-tool, authentication, and stop-control proof.
4. Vercel production project/domain/rewrite maintenance control proof.
5. Stripe/webhook, QuickBooks, financial-outbox, and scheduled-consumer live hold/retry evidence.

## P1/P2

- P1: V1 in-process timer shutdown acknowledgement, email-attempt ambiguity rehearsal, and statement-level maintenance timing.
- P2: a repository-maintained, sanitized evidence collector once authenticated control-plane APIs are available.

No M8/M9 work starts from this milestone. M7 remains **NO-GO** and the required Lovable/V2 UI-convergence milestone still precedes any production cutover.
