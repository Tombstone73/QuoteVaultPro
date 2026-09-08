# M7.7B DEV schema reconciliation

## Scope and target

This is a DEV-only forward repair for the audited `PrintersHero-DEV / Development` Railway deployment. It is not a production runbook, does not modify `main`, and never updates `public.__drizzle_migrations_v2`.

The diagnosed DEV shape has `268` migration-ledger rows, maximum id `269`, and a maximum historical timestamp of `1788048000120`, while the physical effects of source migrations `0270` through `0273` are absent. Because those journal timestamps are at or below the existing maximum, ordinary Drizzle correctly has no new journal entry to apply; it cannot repair this shape by itself.

## Controlled executor

`v2/scripts/runM77BDevSchemaReconciliation.ts` is a distinct executor rather than an environment override for the clone-only M7.2C runner. It requires all of:

- `M77B_DEV_RECONCILIATION=1`;
- exact Railway target identity `PrintersHero-DEV / Development` with `NODE_ENV=production`;
- a Neon endpoint that is not the production fingerprint;
- an explicit `M77B_EXPECTED_DEV_HOST_SHA256_16` match; and
- the exact audited DEV ledger and physical baseline.

It creates no ledger on a mismatched baseline. Once target preflight succeeds, it uses the existing durable `m7_reconciliation_lock` singleton with `FOR UPDATE NOWAIT`, writes attempt/stage evidence into the existing M7 ledger, executes each source migration in an isolated transaction, and commits a stage only after a physical postcondition digest succeeds. Failed SQL rolls back before a recoverable failure row is written. Completed stages are re-attested on retry.

Stages are narrowly mapped to immutable source:

| Stage | Source | Attested effect |
| --- | --- | --- |
| D0270 | `0270_v2_payment_allocation_aggregate.sql` | Payment allocation uniqueness, allocation-intent column, deterministic allocation completeness |
| D0271 | `0271_v2_refund_allocation_aggregate.sql` | Immutable invoice-allocation evidence and complete historic mapping |
| D0272 | `0272_v2_ai_safe_tool_plane.sql` | AI evidence relations and immutable tool audit |
| D0273 | `0273_v2_ai_assistant_access_capability.sql` | Explicit assistant capability authority |

The two financial stages deliberately abort on ambiguous historic allocation evidence. No record is fabricated to make a stage pass.

## Drizzle gate

`server/runMigrations.ts` now recognizes this **specific** DEV ledger horizon, requires D0273 attestation and the required physical relations, and otherwise fails closed. Fresh databases and unrelated/unknown horizons retain their normal migration behavior. The normal migration script invokes the executor only when the explicit acknowledgement is set.

## Execution status

DEV execution succeeded on 2026-09-08 after two intentionally non-mutating preflight refusals established the endpoint fingerprint and the actual ledger shape (`268` rows, maximum id `269`, maximum timestamp `1788048000120`). D0270 was already physically present and was adopted only after its postconditions passed; D0271--D0273 executed forward in separate transactions and were attested. The subsequent normal migration runner passed the D0273 gate and all 86 existing release verification checks. Drizzle history remained unchanged at maximum id `269`.

The temporary acknowledgement is set back to `0` after completion. Later DEV deployments verify the D0273 attestation through the normal gate but do not re-run the executor.
