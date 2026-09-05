# M7.3A cutover evidence gate

## Purpose

`npm run v2:m7_3a:cutover-evidence-gate` validates a fresh, sanitized JSON evidence manifest before any future production reconciliation executor is allowed to begin. It discovers nothing, performs no database/provider action, and rejects secrets in evidence references.

The caller supplies the manifest through `M73A_CUTOVER_EVIDENCE_FILE` and the independently controlled, non-secret endpoint fingerprint through `M73A_EXPECTED_PROD_HOST_SHA256_16`. A manifest cannot set its own trusted target.

## Required evidence

The manifest schema `m7.3a-cutover-evidence-v1` requires all of the following:

- `MAINTENANCE_INGRESS = CLOSED` through the M7.2F runtime authority observation.
- `PRINTERSHERO_V1_RAILWAY_REPLICAS = 0`, with fresh Railway read-only evidence.
- `V2_PROD_RUNTIME = NOT_RUNNING_AGAINST_PROD`.
- `MCP_PROD` and `MCP_DEV` have no current write authority.
- `RECONCILIATION_EXECUTOR = NOT_ALREADY_ACTIVE`, with target-bound database read-only evidence.
- `FINAL_RESTORE_POINT = VERIFIED`, with Neon metadata evidence tied to the target fingerprint.
- `ACTIVE_WORK_MANIFEST = CAPTURED`, tied to the target and covering Orders, Production jobs, Prepress, Fulfillment, Invoices, Payments, financial/provider jobs, and email/delivery queues.

Each active-work category carries only a non-negative aggregate count and a status-distribution digest. It is evidence, not a per-record handoff or migration authority.

## Fail-closed semantics

Evidence older than five minutes, future-dated timestamps, duplicate/missing runtime authorities, malformed fingerprints/digests, secret-bearing references, nonzero V1 replicas, an unverified restore point, a target mismatch, an incomplete work manifest, or a live/unknown reconciliation owner all fail the gate. The work manifest must precede (or be simultaneous with) zero-replica proof; restore verification must follow it.

## Executor boundary

`v2/scripts/runM72CReconciliation.ts` remains a clone-only rehearsal executor and categorically refuses a production endpoint. M7.3A does not weaken that safety property. Any separately approved production executor must first invoke this gate using the same verified endpoint fingerprint and must re-check durable single-executor ownership immediately after connecting. Until that executor and the provider prerequisites are explicitly approved, production reconciliation cannot start.
