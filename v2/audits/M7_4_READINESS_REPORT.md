# M7.4 readiness report

## Disposition: BLOCKED

M7.4 identifies the current production resource/configuration surface without exposing values. It does not prove external target identity from redacted variable names, and it found a tracked V2 production-start blocker.

## P0

1. `requireV2DeploymentDatabaseUrl()` categorically allows only Railway `PrintersHero-DEV / Development`; the V2 deployment entrypoint invokes it. V2 cannot start against actual production without a separately reviewed production target/endpoint guard.
2. `v2/ui/vercel.json` routes V2 API and OAuth callbacks to `api-dev.printershero.com`. It is DEV-only configuration and cannot serve as the production frontend configuration.
3. Stripe live account/webhook, QuickBooks production authorization/realm, Gmail canonical V2 readiness, and Supabase production target/policy are unproven; variable-name presence is insufficient.
4. M7.3B Vercel and Neon production-control-plane P0s remain unresolved.

## P1/P2

- P1: initial V2 invoice/proof queues default on; explicit disabled flags and non-queue QuickBooks ownership are required before first V2 read-only start.
- P1: preserve encryption-key continuity for QuickBooks and Gmail/email integration tokens; plan re-encryption before any key rotation.
- P1: V1 automatic migration and worker defaults require explicit restart controls, in addition to actual zero-replica evidence.
- P2: MCP and the local file bridge are future/optional and not cutover blockers.

M7 remains **NO-GO**. UI convergence is deferred and is not added as an automatic blocker by M7.4.
