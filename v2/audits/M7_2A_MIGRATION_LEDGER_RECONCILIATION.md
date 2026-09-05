# M7.2A migration ledger reconciliation

**Disposition: BLOCKED for repair; forensic reconciliation complete enough to prohibit normal replay.** This report is metadata-only. No production DDL, migration, business-data access, or provider operation occurred.

## Journal semantics

The canonical V2 migration source is server/db/migrations_v2 with meta/_journal.json. Drizzle reads each SQL file as bytes, hashes the raw content with SHA-256, and records hash plus the journal `when` value in public.__drizzle_migrations_v2. It does not use migration number as the apply key.

At startup, server/runMigrations.ts packages and invokes the Drizzle migrator before routes/workers. The migrator compares every migration's `when` to the single greatest ledger created_at: a migration at or below that value is skipped. SQL statements and the ledger insert are run in the migrator transaction, but a future deployment can execute later migrations before release post-checks reject the resulting state. Repository CI guards history; it cannot prove what an older deployed artifact or manual ledger operation did.

Important provenance limitations:

- A baseline bookkeeping row and a one-off ledger-repair script demonstrate that journal rows are not universal proof that matching SQL ran.
- Current history is append-only protected through M0263, but the manifest records rejected-before-ledger repairs for M0231/M0232 and M0257.
- Journal `when` values are ordering values, not source commit/deployment timestamps.
- Migrations are immutable. This milestone does not authorize changing them or changing production ledger rows.

## Production ledger inventory

Production has 194 ledger rows. Rows 175 through 194 map one-for-one by exact `created_at` to M0180 through M0199:

| Ledger rows | Tags | Current raw SQL hash match | Physical conclusion |
| --- | --- | --- | --- |
| 175-179 | M0180, M0181, M0182, M0183, M0184 | yes (5/5) | Foundation/permission schema evidence is present; M0181 seed-data values were not readable by the restricted grant. |
| 180-181 | M0185, M0186 | no (2/2) | Final permission functions/triggers are physically present, but the historic source bytes are divergent/unproven. |
| 182-194 | M0187-M0199 | no (13/13) | Required V2 sales, audit, routing, billing, artwork, and proof relations are absent. |

The ledger tail is exact: row 194 has `created_at=1788048000046`, current journal tag M0199. Its ledger hash `a43eb623...` differs from the current M0199 raw-SQL hash `ce1663b4...`. This pattern starts at M0185, not at M0199.

## Physical truth and trustworthy boundary

Production physically has the M0180 foundation tables and the M0181 permission-set family: 15 V2 tables, 110 columns, 62 constraints, 33 indexes, and six V2-related triggers. Catalog evidence confirms the expected M0180 constraints/indexes and M0182-M0184 permission trigger surface. The final M0185/M0186 permission functions/triggers exist, but the matching ledger hashes do not identify the historical SQL bytes.

**Earliest trustworthy boundary:** M0184 is the last point where current journal order, exact current SQL hash, and required physical postconditions agree. The true migration starting state for a future repair plan is therefore the *actual M0180-M0184-compatible permission/foundation schema plus M0185/M0186-like permission physical state*, not a clean M0199 or current-repository baseline.

**First divergence:** M0185. It is content divergence: the ledger hash does not match current source, while related physical functions/triggers exist. M0187 is the first conclusive journaled-but-physically-absent domain migration.

## Per-migration classification

| Migration range | Classification | Evidence and postcondition result |
| --- | --- | --- |
| M0180 | PROVEN_APPLIED | Ledger hash matches current raw SQL; all three foundation relations, required primary/unique/FK/check constraints and indexes are catalogued. |
| M0181 | PROVEN_APPLIED (schema); UNKNOWN_PROVENANCE (seed data) | Ledger hash matches; all 12 permission relations and base composite unique constraints exist. Restricted role lacks data grants needed to prove bootstrap rows. |
| M0182-M0184 | PROVEN_APPLIED | Hashes match current SQL and expected admin-floor/principal-kind column and trigger/function postconditions exist. |
| M0185-M0186 | CONTENT_DIVERGENCE; HISTORICAL_EQUIVALENT only for observed trigger/function surface | Ledger hashes differ, yet the final permission functions/triggers are present. Exact historic definitions cannot be recovered from current reachable repository evidence. |
| M0187-M0191 | JOURNALED_PHYSICALLY_ABSENT | Hashes differ; seven expected sales relations are absent. Expected legacy uniqueness/FK postconditions are not established. |
| M0192 | JOURNALED_PHYSICALLY_ABSENT | Hash differs; v2_audit_events is absent. |
| M0193-M0194 | JOURNALED_PHYSICALLY_ABSENT | Hashes differ; all four routing relations and product-type routing postconditions are absent. |
| M0195-M0196 | JOURNALED_PHYSICALLY_ABSENT / UNKNOWN_PROVENANCE for data repair | Hashes differ; both billing relations and sales-link postconditions are absent. M0196's permission-set data mutation cannot be evaluated with the audit grant. |
| M0197-M0198 | JOURNALED_PHYSICALLY_ABSENT | Hashes differ; artwork-file and assignment relations are absent. |
| M0199 | JOURNALED_PHYSICALLY_ABSENT | Hash differs; all four proof relations and proof grants are absent. |

## Repository provenance result

Current repository history has a protected 259-entry journal through M0263. M0199 was introduced in reachable git history at 785457a1, but current source is not provably the same content that produced the production M0199 ledger hash. No reachable historic version matching the divergent ledger hashes was established in this audit. Therefore the cause could be historic file alteration, a different branch/artifact, a manual ledger catch-up, or another divergent history; do not select one without new evidence.

## Reuse conclusion

The existing chain cannot be safely reused as-is. Drizzle will skip M0185-M0199 because their `when` values are at or below the ledger maximum, then a deployment may attempt M0200+ against absent prerequisites. No ordinary db:migrate, application startup, or deployment is safe.

The eventual repair must be a new forward-only reconciliation sequence, designed and rehearsed against a clone from the physical state documented above. It must not edit historical SQL or blindly insert/delete ledger entries.

## Scope ledger

Production mutation: one ephemeral password rotation for printershero_m7_audit to perform the fingerprint. Application/business-data mutations: none. Provider writes: none. DDL/migrations: none.
