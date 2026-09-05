# M7.3A readiness report

## Disposition: BLOCKED

M7.3A completed the fail-closed local evidence tooling and exact operational procedures, but cannot prove the two provider-controlled prerequisites with the access available in this environment.

## Completed

- The maintenance model is defined: a reversible static production-frontend shell plus immediate zero-replica proof for the sole PrintersHero V1 Railway service.
- The restore model is defined: a final Neon snapshot of the verified active production root branch, terminal-operation polling, target-bound metadata verification, and an explicit snapshot/PITR rollback procedure.
- The new M7.3A gate binds six M7.2F runtime authorities, zero V1 replicas, final restore point, active-work aggregates, durable reconciliation ownership, and an independently supplied production endpoint fingerprint.
- The aggregate manifest model covers all eight required categories without per-order handoff behavior.
- A dry run proves valid evidence passes and unsafe/missing/stale/mismatched evidence fails closed.

## P0 blockers

1. The Vercel project/team that controls `www.printershero.com` is not connected. Its owner must read/prove and pre-provision the reversible static maintenance deployment/alias.
2. Neon control-plane metadata is unavailable. An authorized Neon owner must verify the active root branch, snapshot capability, retention/TTL, restore window, and restoration authority before a final snapshot can be declared verified.
3. A production reconciliation executor is not authorized or implemented. The existing executor deliberately refuses production; any future approved executor must invoke the M7.3A evidence gate and re-check the durable lock before SQL.

## P1/P2 findings

- P1: V1 has no server-side maintenance admission control, so the static shell must be closely coupled to Railway zero proof; the shell alone does not stop stale/direct API mutation attempts.
- P1: capture the fresh aggregate active-work manifest and all boundary evidence only during the real cutover window.
- P2: MCP and the optional file bridge remain future-integration records, not current write blockers.

M7 remains **NO-GO**. The mandatory V2/Lovable UI-convergence milestone remains required before M8, independently of these operational blockers.
