# M7.2A readiness report

## Disposition: PASS WITH FINDINGS — M7 remains NO-GO

M7.2A sufficiently explains the ledger/schema contradiction to design a later repair plan. It does not authorize repair, migration, deployment, M7.2B, M8, or M9.

## Conclusion

Production is not an M0199 physical schema. It is an M0180-M0184-compatible V2 foundation/permission schema with an M0185/M0186-like but content-divergent permission trigger surface. The production ledger records through the M0199 ordering timestamp, but M0187-M0199 current-source hashes differ from production ledger hashes and their required V2 relations are absent.

Normal migration reuse is unsafe: Drizzle will skip the divergent M0185-M0199 window based on the maximum ledger timestamp and may execute M0200+ against absent prerequisites. The only safe eventual path is a separately approved, clone-rehearsed, forward-only reconciliation sequence plus V1 live-work handoff.

## Evidence delivered

- M7_2A_MIGRATION_LEDGER_RECONCILIATION.md: journal semantics, 194-row ledger mapping, hash/provenance result, classifications, boundaries, and reuse conclusion.
- M7_2A_PHYSICAL_SCHEMA_DIFF.md: pg_catalog fingerprint and structured missing/present/different physical postconditions.
- M7_2A_MIGRATION_RISK_MAP.md: live-work relation size inputs, lock/rewrite/compatibility classifications, and migration startup risk.

## Validation

| Area | Result |
| --- | --- |
| Production restricted authentication | PASS: printershero_m7_audit authenticated to neondb using an in-memory password only |
| Production read-only fingerprint | PASS: REPEATABLE READ READ ONLY, transaction_read_only on; 194 journal rows, 1,323 catalog relations, 3,597 columns, 1,155 constraints, 1,086 indexes, 868 type entries, 12 triggers, 44 routines |
| Ledger-to-current hash comparison | PASS: M0180-M0184 5/5 match; M0185-M0199 15/15 differ |
| Physical postcondition comparison | PASS: 15 M0180/M0181 V2 tables present; 20 M0187-M0199 required relations absent |
| Repository integrity / journal monotonicity | PASS: 259 protected V2 migrations unchanged; repository monotonicity guard also passed during provenance inspection |
| Scratch reconstruction | NOT RUN: no local PostgreSQL server, psql client, Docker runtime, or supplied TEST_DATABASE_URL was available. No new local DB infrastructure was provisioned. |
| DEV comparison | static repository/migration comparison completed; no DEV mutation or full M6 rerun |
| MAIN / deployment | untouched / not performed |

## Remaining unknowns

- Exact historic SQL/function bytes that produced production ledger hashes M0185-M0199, including whether they came from an unreachable branch/artifact or manual ledger catch-up.
- Permission bootstrap/seed data and M0196 data-repair effects, intentionally outside the audit role's SELECT allowlist.
- Clone-based DDL rehearsal, precise lock durations, and final data mapping/reconciliation behavior.
- Actual production migration env values, packaged dist journal fingerprint, startup logs/advisory-lock holder, MCP process/tool authority, and Vercel topology.

## Scope ledger

Production mutation: two ephemeral printershero_m7_audit password rotations (the first catalog run stopped at a sequence metadata query; the corrected run completed). Application/business-data mutations: NONE. Provider writes: NONE. DDL, migration execution, deployment, Railway/Vercel changes, service restarts, and MAIN changes: NONE.

## Recommended M7.2B scope

M7.2B: Forward-Only Migration Repair Plan, Rollback Design, clone rehearsal, and V1 in-flight-work handoff. It must begin with a schema-only clone of the actual production state, not with automatic migration or historical-file edits. Do not start it automatically.
