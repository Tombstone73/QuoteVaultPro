# M7.2F readiness report

## Disposition: BLOCKED

M7.2F conclusively narrows the single-service claim: it is true for the PrintersHero Railway project, but not yet safe for the complete production authority boundary.

## Proven

- PrintersHero V1 is one Railway service/replica with no Railway cron; stopping it terminates its API and in-process writers.
- Stripe, QuickBooks and Gmail do not independently mutate PrintersHero database state while that Railway process is stopped; Stripe outage events should be retried/reconciled by event identity after V2 readiness.
- MCP is **NO CURRENT WRITE AUTHORITY — FUTURE INTEGRATION**.
- The optional file bridge is **NO INDEPENDENT PROD DB WRITE AUTHORITY — FUTURE/OPTIONAL**.

## P0

1. Establish whether active `prepresshero` API/worker services target PrintersHero PROD database, Supabase/storage, or providers. Read-only Railway OAuth redacts the needed values; resolve with a sanitized target fingerprint/owner assertion from the service owner, or include those services in the cutover stop/zero-replica proof.
2. If those services are in scope, prove their active-work drain and provider hold behavior before reconciliation. QuoteVaultPro's M7.2D prepress fix does not cover this separate runtime.

## P1/P2

- P1: establish a real production Vercel/static maintenance route or alias and verify it before stopping Railway.
- P1: obtain a final database restore-point procedure and read-only executor/migration-lock evidence at the boundary.
- P2: retain MCP and local-file bridge as future integration records; they are not present writer blockers.

M7 remains **NO-GO**. The mandatory Lovable/V2 UI convergence milestone remains required before M8.
