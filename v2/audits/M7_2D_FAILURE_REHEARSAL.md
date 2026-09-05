# M7.2D Failure / Retry Rehearsal Plan

Status: source-only preparation. No clone, production, provider, or application runtime was contacted by this milestone.

The direct reconciliation executor has a single advisory lock, a separate attempt ledger, stage state, and physical-postcondition digest. The pure control checks in `v2/tests/modules/reconciliationControls.pure.ts` cover the decision rules that must hold before the clone exercises them.

| Injection boundary | Required clone procedure | Expected evidence |
| --- | --- | --- |
| R0264 preflight | Use an intentionally wrong endpoint fingerprint or ledger shape | Abort before reconciliation ledger DDL or stage SQL; secret-free error envelope |
| Before stage SQL | Terminate after attempt/stage `running` record and before the first source statement | Retry restarts that stage, preserves prior completed stage digests |
| During transactional DDL | Inject a failing statement after a deterministic source statement | Transaction rollback; failed attempt/stage record; no partial relation or duplicate row |
| Between resumable data batches | Only if a future evidence-complete manifest backfill exists | Progress cursor retained; retry does not duplicate source identities |
| Completed stage rerun | Reinvoke with the same endpoint and source digest | Re-attestation then skip; no DDL or business-data mutation |
| Postcondition drift | Alter only an ephemeral test clone after a completed stage | Reinvoke fails closed on digest/postcondition mismatch |
| Missing or incompatible object | Start a fresh representative clone with a deliberate incompatible fixture | R0264/pre-stage catalog validation aborts before dynamic repair |
| Reconciliation-ledger mismatch | Modify only a disposable clone ledger fixture | Abort; no silent ledger replacement |
| Competing executor | Hold the advisory lock from a second clone-only session | Second executor exits immediately; it neither waits indefinitely nor steals the lock |
| Drizzle before R0269 | Invoke migration gate after preflight/partial stage completion | Normal migration is refused until the R0269 attestation record is valid |

Fresh-clone result placeholders:

- Clone identity/fingerprint: NOT RUN
- Failure injection command/version: NOT RUN
- Ledger snapshots (sanitized): NOT RUN
- Retry result and duplicate-count comparison: NOT RUN
- Lock-holder/contender timestamps: NOT RUN
- Drizzle-gate rejection/acceptance result: NOT RUN

No automatic legacy data backfill may be introduced merely to make this plan pass. Artwork, proof, finance, provider, and queue records remain manifest-gated and evidence-complete.
