# V2 Reuse and Rewrite Inventory

This matrix classifies production value, not code age. “Reuse” means preserve contracts, pure components, or selected infrastructure behind V2 ports; it does not authorize copying V1 route-owned mutation logic.

| Area | V1 keep | V1 adapt | V2 POC reuse | Rewrite | Reason |
| --- | --- | --- | --- | --- | --- |
| PBV2 evaluator | pure option-tree evaluator | pricing DTO adapter | contract/parity tests | no second evaluator | single proven evaluator |
| Pricing/tax | pricing rules/tests | scoped configuration and cents boundary | canonical pricing contract | route-local calculations | eliminate drift |
| Quotes/conversion | snapshot semantics, atomic conversion tests | repositories | conversion invariants/tests | application operation | preserve locked commercial snapshot |
| Direct orders | order/invoice compatibility fields | repository mapping | request/idempotency/rollback ideas | create operation | V1 has process-local retry and split init |
| Artwork/proof/prepress | file records, lifecycle knowledge | storage/projection adapters | lineage/token/retry contracts | ownership and outbox | current paths bypass canonical state |
| Production | run/member persistence, workflow knowledge | repositories | outcome/locking tests | application operations | duplicate route recovery paths |
| Fulfillment | quantity data/UI | repository compatibility | shared availability/locking | operations/reconciliation | terminal billing recovery gap |
| Invoices/payments | invoice-line authority, tests | financial compatibility | provider recovery contracts | canonical finance/outbox | V1 split commits/direct headers |
| AI Plan/GO | registry, staff/org binding | adapter + durable plan records | delegated-principal model | AI business mutation paths | AI must not be privileged writer |
| Inbound | ingestion/parser/evidence/review | source adapters | separation of review from mutation | final submission calls | V1 has alternate order persistence/tax |
| Portal | UI/sessions/customer experience | filtered DTOs/principal adapter | customer-scoped operation tests | unsafe backend response/mutation paths | prevent data exposure/impersonation |
| Authentication | sessions/local auth | Principal issuer | policy model | mixed guards | one authority contract |
| Storage/email | object placement/preview/PDF | integration ports/outbox | failure/retry ideas | direct side effects | preserve assets, make recovery durable |
| QuickBooks | OAuth/UI/credential mapping | queue adapter | reconciliation principle | worker ownership/sync contract | external recovery remains unknown |
| Local Bridge | outbound least-privilege agent | V2 job adapter | none | direct V1 job producer | isolate device integration |
| React UI | shell/layout/design components | queries/DTOs | interface boundary rules | mutation forms/workflows selectively | avoid visual rewrite, replace authority |
| Shared types | stable value types | versioned V2 DTOs | principal/operation types | leaking persistence shapes | compatibility without coupling |
| Migration infrastructure | existing runner/journal | immutable preflight/postconditions | clone safety model | startup DDL/manual repair patterns | DEV audit proves ledger is insufficient |

## POC classification

| POC area | Production treatment |
| --- | --- |
| AuthorityPolicy/principal vocabulary | production candidate after API/auth issuer design and broader capability registry |
| Postgres repositories | concept/reference only; rebuild with production migrations, observability, error taxonomy, and no inline DDL |
| Request/attribution/reconciliation tables | architectural idea and test contracts; consolidate/redesign rather than copy table-per-slice |
| PBV2 adapter | refine selected code only after dependency/API review; preserve parity tests |
| Quote/order/artwork/fulfillment/finance tests | high-value contract and clone integration seed |
| Jest safety harness | retain principle; production clone workflow must accept an explicitly approved clone even if its DB name lacks `test` |
| Interface adapters | reference only; rebuild as real HTTP/session/API/Portal adapters |

## V1 tests disposition

- **Directly reuse:** pure PBV2/pricing, money, validation, tenant-scope, storage identity, and Local Bridge safety tests.
- **Adapt into V2 operation contracts:** quote/order conversion, artwork/proof, production, fulfillment, billing/payment, AI authority, and Portal flows.
- **Parity tests:** route behavior whose semantics matter but implementation must change, including pricing, status transitions, document snapshots, quantities, and provider outcomes.
- **V1-only until retirement:** legacy route wiring and obsolete compatibility UI specifics.
- **Retire only with evidence:** source-string/implementation tests replaced by behavioral failure contracts.
