# M7.6 — AI permission-parity ledger

`assistant.use` admits a staff member to the Assistant. It never replaces a domain capability. Every AI write is Prepare → exact proposal → literal `GO` → fresh authority/state validation → one canonical operation request.

| Domain | Action | User capability | UI/API | AI status | GO | Hard deny | Canonical service / blocker |
|---|---|---:|---:|---|---:|---:|---|
| CRM | Search / activity | `customer.view` | Yes | LIVE_READ | — | No | Customer workspace projection |
| CRM | Create Customer | `customer.edit` | Yes | DEFERRED_WITH_EXPLICIT_REASON | Yes | No | Creation lacks request reservation and deterministic duplicate policy |
| CRM | Add/update Contact; update Customer; set primary | `customer.edit` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Durable administration service: revision-checked and replay-safe |
| Sales | Search Orders / Quotes | `order.view` / `quote.view` | Yes | LIVE_READ | — | No | Sales workspace projections |
| Sales | Create Order / update header or commercial note | `order.create` / `order.edit` | Yes | ADAPTER_MISSING | Yes | No | Idempotent Order service; server pricing and frozen facts only |
| Workflow | Production Not Required | `workflow.override` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Canonical workflow service |
| Workflow | Direct Production | `workflow.override` | Yes | ADAPTER_MISSING | Yes | No | Exact frozen destination required |
| Artwork | Metadata reads | `artwork.view` | Yes | LIVE_READ | — | No | Bounded workspace projection |
| Artwork | Assign an existing file | `artwork.assign` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Reservation/audit seam; no binary upload through chat |
| Proof | Queue/status | `proof.view` | Yes | LIVE_READ | — | No | Canonical Proofing service |
| Proof | Issue / retry delivery | `proof.issue` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Canonical queue only; no provider email direct call |
| Proof | Record customer approval | `proof.respond` | Yes | DEFERRED_WITH_EXPLICIT_REASON | Yes | No | AI must not impersonate customer evidence |
| Prepress | Queue/readiness | `prepress.view` | Yes | LIVE_READ | — | No | Canonical service |
| Prepress | Send to Production | `prepress.complete`, `route.advance`, `production.work` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Atomic frozen-route handoff, all capabilities delegated |
| Production | Queue/progress | `production.view` | Yes | LIVE_READ | — | No | Canonical service |
| Production | Start / record output / complete | `production.work` / `production.complete` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Attempt locks, quantity and retry validation |
| Fulfillment | Workspace / tracking | `fulfillment.view` | Yes | LIVE_READ | — | No | Canonical projection |
| Fulfillment | Pickup / shipment handoff allocations | `fulfillment.pickup` / `fulfillment.ship` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Immutable handoff allocations |
| Shipment | Create / attach / mark shipped | `fulfillment.ship` | Yes | DEFERRED_WITH_EXPLICIT_REASON | Yes | No | No request identity/audit; invalid attach-after-shipped sequence |
| Inbound | Mark an intake duplicate | `inbound.review` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Canonical terminal decision with request reservation |
| Finance | Invoice/payment/refund history | `payment.view` | Yes | LIVE_READ | — | No | Canonical financial read service |
| Finance | Record manual payment / refund | `payment.record` / `refund.issue` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Immutable ledger and operation reservation; no provider call |
| Finance | Card / ACH checkout | `payment.record` | Yes | DEFERRED_WITH_EXPLICIT_REASON | Yes | No | UI-only secret client-authentication handoff |
| Finance | Provider confirmation/webhook | service only | Yes | UNSUPPORTED_CANONICAL_OPERATION | — | No | Signed provider service action, not staff action |
| QuickBooks | Sync/retry/enqueue | varies | Partial | DEFERRED_WITH_EXPLICIT_REASON | Yes | No | Needs durable request identity and actor audit; worker is sole provider writer |
| Commercial | Customer entitlement / pricing agreement | `product.edit` / `pricing.configure` | Yes | DEFERRED_WITH_EXPLICIT_REASON | Yes | No | No replay-safe request identity |
| Product | Create/abandon a Draft | `product.edit` | Yes | LIVE_WRITE_WITH_GO | Yes | No | Revision-guarded canonical lifecycle; configuration/publication remain deferred |
| Settings | Non-secret organization/numbering/tax values | configure capability | Yes | ADAPTER_MISSING | Yes | No | Narrow typed/redacted adapter required |
| Team / permissions | Self authority / grants | admin | Yes | PERMANENTLY_DENIED | — | Yes | AI cannot change authority or bypass RBAC |
| Infrastructure | SQL, secrets, provider controls, destructive tenant actions | owner/developer | Partial | PERMANENTLY_DENIED | — | Yes | Never model-addressable |

## M7.6D accounting

- Eligible staff operations inventoried: 27
- Live AI parity actions: 11 write families and 10 read families
- Live or already-parity entries: 21 / 27 (78%)
- Permanent AI hard-deny entries: 2
- Canonical-service/idempotency gaps: 4 (Customer creation, shipment containers, commercial agreements, QuickBooks queue actions)
- Pure adapter gaps: 3 (Sales commands, Direct Production, safe Settings)

“Adapter missing” is not a user-permission denial.
