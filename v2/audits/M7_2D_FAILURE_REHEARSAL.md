# M7.2D Failure / Retry Rehearsal Plan

Status: source plan plus executed fresh-clone rehearsal. No production, provider, or application runtime was contacted.

The direct reconciliation executor has a durable row lock, a separate attempt ledger, stage state, and physical-postcondition digest. The pure control checks in `v2/tests/modules/reconciliationControls.pure.ts` cover the decision rules that must hold before the clone exercises them.

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

## Executed fresh-clone results

The fresh endpoint's safe fingerprint was `6aba709b18a02044`. It was distinct from PROD and began with the audited 194-row M0199 ledger, absent Sales/Proof foundation, and unchanged V1 counts: 350 orders, 478 production jobs, 257 invoices, and 24 payments.

| Boundary | Observed state | Result |
| --- | --- | --- |
| Before R0265 | R0264 attested; R0265 failed/unattested; 194-row Drizzle ledger; Sales/Proof absent. | **RETRY SAFE** — rerun completed R0265. |
| After R0265 | R0265 attested; attempt interrupted before R0266; no Drizzle advance. | **RETRY SAFE** — rerun re-attested R0265. |
| After R0266 SQL | R0266 failed/unattested; Sales remained, Routing/Billing and Proof remained absent; V1 counts and Drizzle ledger unchanged. | **RETRY SAFE** — DDL rolled back, then rerun completed R0266. |
| Before R0269 | R0264--R0268 attested; R0269 failed/unattested; normal Drizzle refused. | **RETRY SAFE** — rerun completed R0269. |
| After R0269 / before Drizzle | All six stages attested and historic 194-row journal remained truthful. | **RETRY SAFE**. |
| Normal follow-on | Drizzle reached 258 rows/latest `1788048000110`; all 86 release checks passed. | **FORWARD COMPLETE**. |

Final read-only evidence confirmed all six attestations, Sales/Routing/Billing/Proof foundation, and unchanged V1 aggregates. A mid-normal-Drizzle interruption was not run because this one disposable clone was preserved for successful follow-on; it remains a P1 rehearsal gap.

No automatic legacy data backfill may be introduced merely to make this plan pass. Artwork, proof, finance, provider, and queue records remain manifest-gated and evidence-complete.
