# M7.3B readiness report

## Disposition: BLOCKED

M7.3B made the evidence and executor contracts stricter, but authenticated production control-plane proof is still unavailable for both providers.

## Completed

- The Vercel maintenance switch is defined as an immutable static deployment plus a reversible production alias/promotion action, paired with immediate Railway zero-replica proof.
- The Neon recovery model is corrected to require verified root-branch snapshot capability and provider-operation polling; it does not assume a generic backup or child branch is adequate.
- The M7.3B evidence contract now requires attributable Vercel control-plane metadata and root-snapshot/provider-operation metadata in addition to the M7.3A operational evidence.
- The preparation-only production-executor contract revalidates the evidence package, pins an independently supplied endpoint fingerprint, and requires a run ID, approval, immutable source revision, launch reference, and durable log-retention reference. It has no database or provider client and cannot execute SQL.

## P0 blockers

1. Vercel OAuth access does not include the team/project that owns `www.printershero.com`; its production deployment, alias, and switch/rollback permission are unproven.
2. Neon control-plane access is absent; production project/root branch, snapshot or PITR capability, retention, and restore authority are unproven.

## P1/P2 findings

- P1: after the two provider proofs, rehearse only the approved non-production maintenance/restore mechanics where safe; do not treat a frontend shell as a write barrier without Railway zero proof.
- P1: a separately reviewed, explicitly M8-authorized direct runner is still required to perform SQL after the preparation gate; the current clone runner intentionally refuses production.
- P2: no Vercel or Neon change is needed until the explicit M8 window; retain only sanitized evidence references.

M7 remains **NO-GO**. Mandatory V2/Lovable UI convergence remains required before M8.
