# M7.2C isolated clone reconciliation rehearsal

## Result: schema reconciliation and normal Drizzle follow-on passed

The clone began with the exact production-audited divergence: 194 historical ledger rows, latest timestamp `1788048000046`, M0180--M0184 physical foundation present, and the M0187--M0199 domain absent. R0264, R0265, R0266, R0267, R0268, and R0269 each completed with an attested postcondition.

No V1 business row was copied into new V2 structures. After reconciliation and M0200--M0263 follow-on, V1 aggregates remained 350 orders, 478 production jobs, 257 invoices, and 24 payments; immediate V2 reconciliation domains remained empty (sales documents, route instances, artwork files, and proof works were all zero). This preserves V1 authority rather than inventing V2 commercial, financial, or file history.

The unchanged normal runner passed the new pre-Drizzle gate, migrated the ledger to 258 rows with latest timestamp `1788048000110`, and passed all 86 release verification checks. A second full executor invocation retained R0264's historical attestation and re-attested R0265--R0269 without reapplying DDL. A deliberately mismatched endpoint fingerprint was rejected before connection.

## Observations

The post-rehearsal relation sizes were small: orders 933,888 bytes, production jobs 606,208 bytes, invoices 1,064,960 bytes, and payments 303,104 bytes. New empty V2 relations were 40--57 KB. The stage DDL ran transactionally on this clone; no measured table rewrite or sustained lock was observed. Clone timing is planning input only, not a production-duration estimate. Production classification is **SHORT MAINTENANCE** until a dedicated clone with lock telemetry exercises the same work at a production cut point.

## Limits

The available endpoint describes one already-completed child clone. It did not provide branch-management authority to create a second clean baseline. Consequently, interruption immediately after a fresh stage's SQL, batched-backfill restart, incompatible pre-existing-object, and ledger-corruption cases are covered by fail-closed implementation and pure contracts, but were not destructively replayed against this completed clone. No backfill exists in these stages, so there was no batch/empty-`IN()` path to exercise.
