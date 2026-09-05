# M7.2B forward-only reconciliation plan

## Disposition: DESIGN ONLY — CLONE REHEARSAL BLOCKED

This plan does not authorize production DDL, migration execution, worker changes, or deployment. Historical M0185-M0199 files remain immutable and must never be replayed, renumbered, or ledger-edited.

## Critical ordering conclusion

A conventional post-head Drizzle migration such as M0264 cannot repair production. The production ledger maximum is M0199, so normal Drizzle would skip M0185-M0199 and execute M0200-M0263 before ever reaching M0264. That is unsafe because M0200+ requires missing M0187-M0199 objects.

The repair therefore requires one purpose-built, direct-connection **pre-Drizzle reconciliation executor** with its own reconciliation attempt/marker ledger. It runs staged, forward-only definitions before normal Drizzle is permitted. It must not advance __drizzle_migrations_v2 to an M0264+ timestamp prematurely. Only after its postconditions pass may normal Drizzle apply M0200-M0263; post-head normal migrations may then attest the completed state idempotently.

## Proposed new definitions — not created or executed

| ID / proposed artifact | Preconditions and physical postconditions | Data / compatibility rule | Lock and rollback class |
| --- | --- | --- | --- |
| R0264 m0199_reconciliation_preflight_and_guard | Assert exact M0199 ledger maximum; verify M0180-M0184; fingerprint/preserve M0185-M0186; require M0187-M0199 and M0200+ relation absence; reject partial state and duplicate legacy tenant identities | no data change | online/read-only preflight; failure means abort with no DDL |
| R0265 m0199_sales_audit_schema | Create/verify M0187-M0192 sales and audit relations, definitions, triggers and indexes | no blanket historical permission DML; V1 sales stays canonical | isolated-table DDL is additive; legacy composite unique index concurrently, then short maintenance constraint attach |
| R0266 m0199_routing_billing_schema | Create/verify M0193-M0195 routing/billing relations and staged product_types routing compatibility | do not replay M0196 capability deletion | nullable columns -> verified backfill -> NOT VALID checks/FKs -> validate -> final NOT NULL; forward-fix after activation |
| R0267 m0199_artwork_proof_schema | Create/verify M0197-M0199 artwork/proof relations, hardening checks, immutable-history functions/triggers | no automatic legacy attachment/proof import | additive schema; activate only in maintenance gate |
| R0268 m0199_permission_reconciliation | Preserve M0185/M0186 physical semantics; verify capabilities/templates/grants | customized organization permission sets change only from an approved per-org intent manifest | maintenance required; never replace historic structures solely on source mismatch |
| R0269 m0199_postcondition_and_activation | Fingerprint every relation, column, default, constraint, index, FK, function, trigger, extension and permission invariant; emit reconciliation marker | V2 canonical tables remain empty unless a separately approved import manifest validates rows | no normal Drizzle until all checks pass; later M0264+ scripts are attestation/no-op only |

## Target physical schema

The required canonical V2 target is the fully verified current V2 migration chain, not a DEV rehearsal artifact: M0180-M0199 repaired as above, then M0200-M0263 applied through one normal Drizzle executor. DEV-only browser/rehearsal objects and fixtures are excluded. Required compatibility references retain legacy organizations, users, customers, contacts, products, product types, V1 financial records, storage keys, and operational IDs until explicit import decisions are proven.

## Data reconciliation design

| Source | Target / transformation | Idempotency and conflict rule | Unknown handling / rollback |
| --- | --- | --- | --- |
| Organizations, users, customers, contacts, products, product types | retain as canonical legacy compatibility references; add only verified tenant composite identity support | preflight rejects duplicates; no overwrite | stop and manually classify incompatible identity |
| Quotes, orders, lines | optional V2 sales import only with currency, durable numbering, valid customer/contact links, pricing evidence, configuration and status translation | source PK + target PK + transform version + source fingerprint + idempotency key; payload mismatch aborts | UNMIGRATABLE_LEGACY, retain V1 read-only; no guessed state |
| 191 in-production orders / 320 queued jobs | remain V1-owned until drained or per-record handoff manifest approved | manifest includes legacy ID, org, order/line, state, evidence/output references and disposition | ambiguous/marooned jobs need manual adjudication; no bulk reset/retry |
| Artwork, proofs, prepress | import only with immutable object key/checksum, assignment identity and issuance/actor evidence | exact source fingerprint; no overwrite | retain legacy projection |
| Invoices, payments, refunds, Stripe, QuickBooks, outbox | retain V1 history/projection; V2 starts on new V2-owned work only after queue gate | provider IDs/event IDs uniquely idempotent | never fabricate/replay provider action; forward reconciliation only |
| Fulfillment/email | drain terminal work or retain V1 support; map only proven terminal states | source/target disposition manifest | attempting/unknown sends remain ambiguous, not automatically retried |

## Migration control and verification

Freeze V1 and V2 automatic migration. DRIZZLE_AUTO_MIGRATE=0 also suppresses release checks, so a standalone schema verifier must run while automatic migration is frozen. One named executor uses a direct, non-pooled database URL and a reconciliation-specific advisory lock; it releases that lock before normal Drizzle obtains its existing session advisory lock 928372001.

Before M0200 begins, require all 20 missing M0187-M0199 relations with exact catalog postconditions, M0185/M0186 preservation checks, zero opaque permission widening, zero unexpected V2 canonical rows, a reconciliation marker, and clone-proven data validations. Any mismatch aborts before V2 writers start.

## Rollback

- Preflight failure: no DDL; abort and preserve V1-only authority.
- Failed transactional additive stage: transaction rollback and new clone for another rehearsal.
- Failed concurrent unique index: validate then remove only the invalid index; never deduplicate production automatically.
- After additive schema/backfill: forward-fix plus application rollback; do not drop relations after any data appears.
- After V2 writer/provider activity: freeze writers. Resume V1 only if compatibility and ownership gates prove no incompatible V2 state; otherwise forward-fix or a named-authority Neon restore-point procedure. Provider effects are not rollbackable.

## Clone prerequisite

These definitions must first run on an isolated Neon child branch of the verified production branch, with a recorded parent/cut time-or-LSN/child endpoint/TTL and no app, worker, webhook, provider, or public ingress. No actual R0264-R0269 SQL or post-head migration has been created in this milestone because that clone provenance and rehearsal are unavailable.
