# M7.2D Lock and Timing Measurement Plan

Status: bounded contention and end-to-end clone timing measured; statement-level lock telemetry remains unmeasured.

The executor now serializes reconciliation with a durable row lock. The original session advisory lock was not exclusive through the pooled Neon endpoint; M7.2D replaced it with `m7_reconciliation_lock` held by `FOR UPDATE NOWAIT` in a dedicated open transaction. Stage DDL is expected to run in short transactions; any future batch backfill must expose progress and avoid unbounded transaction growth. No provider or application runtime is required for the measurement.

| Operation | Expected lock/concurrency concern | Initial classification | Required fresh-clone measurement |
| --- | --- | --- | --- |
| Advisory lock acquisition | A second executor must fail immediately rather than run concurrently | ONLINE SAFE when uncontended | Contender start/exit time; lock holder identity; release confirmation |
| R0264 catalog preflight | Read-only catalog and ledger reads | ONLINE SAFE | Duration and catalog-read plan |
| R0265 Sales/Audit foundation | New relation/constraint creation; legacy V1 tables receive a small number of additive constraints | SHORT MAINTENANCE pending measurement | Relation sizes, `pg_locks`, statement duration, rewrite indication |
| R0266 Routing/Billing foundation | Product-type additive columns/constraints and new V2 relations | SHORT MAINTENANCE pending measurement | Product-type relation size, lock mode, duration, rewrite indication |
| R0267 Artwork/Proof foundation | New V2 relations and an additive unique constraint on the new artwork relation | SHORT MAINTENANCE pending measurement | Relation sizes after R0265, lock samples, duration |
| R0268 permission reconciliation | Small capability/template seed set; no organization-customized-set rewrite | ONLINE SAFE pending measurement | Row counts, lock samples, duration, proof of no customized-set mutation |
| R0269 attestation | Catalog and aggregate reads | ONLINE SAFE | Duration, schema-fingerprint time, query plans if slow |
| Normal Drizzle follow-on | Existing migration lock plus migrations M0200+ | MAINTENANCE REQUIRED until clone evidence exists | Per-migration timing, locks, conflicts, schema fingerprint |

Measurement protocol for a fresh representative clone:

1. Capture `pg_class` relation sizes and schema fingerprint before each stage.
2. Record wall-clock start/end plus `pg_locks` and `pg_stat_activity` snapshots while each statement runs.
3. Identify table rewrites from relation size/file-node changes where observable.
4. Repeat each stage invocation to demonstrate re-attestation/skip behaviour.
5. Report p50/p95 only after multiple representative clone runs; do not call clone timing exact production timing.
6. Use the largest observed lock window plus V1 writer drain and manifest-capture duration as a maintenance planning input.

Fresh-clone measurement placeholders:

- Clone provenance: NOT RUN
- Relation sizes: NOT RUN
- Lock samples: NOT RUN
- Stage durations: NOT RUN
- Table rewrites: NOT RUN
- Concurrent-access result: NOT RUN
- Cutover-window estimate: NOT RUN

## Executed fresh-clone observations

The initial advisory-lock contention test allowed a contender to proceed despite a holder, exposing a pooled-endpoint defect. After the durable lock correction, the second contender failed immediately with `could not obtain lock on row in relation "m7_reconciliation_lock"` while the holder stayed active.

Fresh-clone command wall times were approximately 5--8 seconds for injected/recovery executor runs and 24 seconds for normal Drizzle M0200--M0263 plus all 86 release checks. These include connection and process startup and are not per-statement production lock durations.

Classification: **SHORT MAINTENANCE**, contingent on a proven V1 write-free boundary. It is not ONLINE SAFE: exclusive schema authority is required. Production timing remains unknown pending statement-level `pg_locks`, relation-size, and V1-drain measurement.
