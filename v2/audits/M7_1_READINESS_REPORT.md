# M7.1 production read-only readiness report

## Disposition: COMPLETE — V2 CUTOVER NO-GO

M7.1's restricted production authentication proof, read-only baseline, migration/schema inventory, business-state inventory, and authority map are complete. This is a **NO-GO** for V2 migration, deployment, or cutover; it does not authorize M7.2.

## Findings

- **P0 — ledger/schema-provenance divergence.** PROD has a 194-row migration ledger whose latest timestamp maps to M0199, but only the M0180/M0181 V2 table families. Required V2 sales, routing, billing, artwork, audit, and proof tables through M0199 are absent. Reconcile controlled DDL and journal hashes before any normal migration action.
- **P0 — live operational state.** Production has 350 orders, 191 currently in production, and 320 queued production jobs. Any writer-authority switch needs an approved in-flight-work reconciliation/resumption design.
- **P0 — MCP authority unknown.** Public checks establish only nginx-root and `/health` version `1.0.0`; read-only process/tool/credential reachability proof is still required.
- **P1 — retained V1 writers.** The one confirmed deployed application is V1. V1 migration startup, prepress bulk claim, Stripe/reconciliation, asset workers, provider routes, and configuration-sensitive worker surfaces must not overlap V2 authority.
- **P1 — delivery and financial operational exceptions.** Two invoice delivery jobs are failed and two need review. Local finance/provider records are populated, but that is not provider-reconciliation evidence.
- **P2 — future audit access.** The dedicated role expires 2026-10-04 UTC; its password is intentionally ephemeral. Repeat controlled in-memory rotation/login rather than retain a shared secret.

## Validation

| Area | Result |
| --- | --- |
| Restricted authentication | PASS: `printershero_m7_audit` authenticated to `neondb` with a password existing only in one audit process |
| Read-only enforcement | PASS: default `on`; explicit `REPEATABLE READ READ ONLY`; prohibited mutation and OAuth-table privileges absent |
| Aggregate inventory | PASS: schema, migration ledger, table counts, status distributions, and metadata collected without PII values |
| Production write scope | PASS: two authorized audit-role password rotations only |
| Application/business data and providers | PASS: zero mutations / provider writes |
| Root TypeScript `npm run check` | expected pre-existing V1/client failures; not attributable to this evidence-only change |
| `npm run v2:check`, `npm run v2:boundaries`, `git diff --check` | pending final execution |
| MAIN / deployment | untouched / not performed |

## Recommended next decision

Do not start M7.2 automatically. The recommended next milestone is a bounded **M7.2 production migration-ledger and physical-DDL reconciliation plan**: read-only hash/DDL evidence first, classification of historical/manual/partial application possibilities, then a separately approved remediation and rollback design. It must also define V1 in-flight-work and worker-authority handoff before any V2 deployment or migration is proposed.

## Scope ledger

Production mutations: `ALTER ROLE ... PASSWORD` for `printershero_m7_audit` twice. Application/business-data mutations: none. Provider writes: none. No migration, deployment, Railway/Vercel configuration write, email send, queue claim, webhook replay, or M7.2 work occurred.
