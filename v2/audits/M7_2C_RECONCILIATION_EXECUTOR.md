# M7.2C pre-Drizzle reconciliation executor

`v2/scripts/runM72CReconciliation.ts` is a direct PostgreSQL, database-only executor. It requires all of: `M72C_REHEARSAL=1`, a dedicated `M72C_RECONCILIATION_DATABASE_URL`, and an exact `M72C_EXPECTED_CLONE_HOST_SHA256_16`. It ignores `DATABASE_URL`, rejects the known production endpoint fingerprint, requires a Neon hostname, uses a dedicated advisory lock, and closes its connection in `finally`.

It creates separate `m7_reconciliation_attempts` and `m7_reconciliation_stages` ledgers. It never updates `__drizzle_migrations_v2`. Every stage records the executor/source hash and finishes only after its physical postconditions are checked and digested. Failures roll back stage SQL, then record a recoverable failed stage outside that transaction. Completed stages are re-attested on retry; R0264 preserves its historical incomplete-baseline attestation because the later successful stages intentionally invalidate its absence checks.

Stages are forward-only:

- R0264 verifies the exact M7.2A clone ledger and physical starting shape.
- R0265 builds M0187--M0191 plus the isolated M0192 audit DDL; no V1 sales/audit row is backfilled.
- R0266 builds M0193--M0194 plus isolated M0195 billing/routing DDL; no V1 financial or routing row is backfilled.
- R0267 builds the isolated M0197--M0199 artwork/proof DDL; no file, proof, or artwork row is backfilled.
- R0268 deterministically seeds only the required capability registry and future-template authority. It does not replay M0185/M0186 and does not change existing organization permission sets.
- R0269 checks the repaired foundation and writes its final attestation.

The historical files remain immutable. Mixed DDL/permission migrations are split at explicit source markers, preventing their legacy per-organization authority mutations from being replayed accidentally.

`server/runMigrations.ts` now fails closed when a database claims the M0199 ledger timestamp but lacks Sales/Proof foundation, unless R0269 has an attested completion. `v2/scripts/runM72CDrizzleFollowOn.ts` proves the ordinary migration runner only follows this gate on an explicitly fingerprinted clone.
