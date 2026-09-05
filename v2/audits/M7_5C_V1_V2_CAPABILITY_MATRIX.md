# M7.5C V1 → V2 capability matrix

**Source audited:** V2 `dev` `0169cad94ee62bb5f25ebd5cede4639fb0993137`; V1 `main` `29b99eb8ad7b94257c09e6a08e3413801b810679`.  
**Method:** source-level operator-task comparison. “Complete” requires usable UI/navigation and an end-to-end canonical path; it is not inferred from a component or endpoint alone. No live DEV/PROD claim is made.

| Domain | Business task | V1 reference | V2 state | Classification | Cutover priority |
| --- | --- | --- | --- | --- | --- |
| Shell | dashboard, alerts, my-work, activity | Titan dashboard/top bar | bounded sales/billing Command Center only | PARTIAL — COMPLETE V2 | P1/M |
| Shell | global search | Ctrl/Cmd+K cross-entity overlay | explicitly disabled pending canonical read model | MISSING — RESTORE CAPABILITY | P1/M |
| CRM | customer/contact CRUD | customer/contact pages | tenant-scoped CRUD and primary contact | PARITY — KEEP V2 | P1 live proof |
| CRM | customer activity, documents, transactions, communications | customer tabs/activity | account/contact detail only; documents/comms unavailable | PARTIAL — COMPLETE V2 | P1/M |
| Quotes | create, price, send, accept, convert | active quote flow | canonical product configuration, preview, delivery readiness, convert | PARITY — KEEP V2 | P1 live proof |
| Orders | list and operational control | rich list/detail and traveler | strong detail; list omits key operational projections/actions | PARTIAL — COMPLETE V2 | P0/M-L |
| Orders | historic V1 record edits | mutable legacy screens | legacy projection is read-only | V1 BEHAVIOR SHOULD NOT RETURN | — |
| Inbound | email intake, parse/review, attach, associate, convert | Inbound Orders UI/server | no V2 UI/API; sidebar label is not routed | MISSING — RESTORE CAPABILITY | P0/L |
| Products | catalog → edit → builder → publish | product admin | immutable ProductVersion Draft/Active Builder; M7.5B fix | V2 IMPROVEMENT — KEEP V2 | P1 live proof |
| Pricing | formulas, matrices, route ownership | mutable/global tooling | revisions, typed inputs, server preview, separate route ownership | V2 IMPROVEMENT — KEEP V2 | P1/S-M |
| Artwork | upload/assign/history | V1 upload/view tooling | canonical PDF upload/assignment/history; no preview/download | PARTIAL — COMPLETE V2 | P1/M |
| Proofing | issue, send/retry, approval/revision evidence | mutable proof queue/actions | immutable exact-artifact proof versions and durable delivery | V2 IMPROVEMENT — KEEP V2 | P1/M |
| Proofing | visual review/revision handoff | thumbnail/viewer/batch actions | no authoritative viewer; weak artwork replacement handoff | PARTIAL — COMPLETE V2 | P1/M |
| Prepress | prepare artwork and complete required unit | active prepress workspace | queue/start/complete/assign existing art; no preview, upload/revise, material context, or handoff clarity | PARTIAL — COMPLETE V2 | P0/L |
| Production | Flatbed/Roll station execution | separate station boards/runs | routed station queue, attempts, material facts, traveler; weak preview/context/batching/touch UX | PARTIAL — COMPLETE V2 | P0/L |
| Production | calendar/Kanban scheduling | V1 boards/calendar | V2 marks calendar non-authoritative | V1 BEHAVIOR SHOULD NOT RETURN without canonical scheduling model | DEFER |
| Fulfillment | partial pickup/shipment and history | fulfillment/shipment workspace | exact partial handoffs, immutable history and PDF | PARTIAL — COMPLETE V2 | P0/L if shipping launch |
| Fulfillment | labels, carrier/tracking, package/combined shipment, scan | V1 shipping/manifest tooling | absent | MISSING — RESTORE CAPABILITY or explicit feature-off | P0/L |
| Workflow | direct-production/no-production paths | V1 forced stages | `workflowIntent` foundation; no policy/authorization UI | NEW V2 REQUIREMENT | P0/M-L |
| Finance | invoices, payments, refunds | provider-heavy flows | canonical exact-cents facts, idempotency, queues and approvals | V2 IMPROVEMENT — KEEP V2 | P1 live proof |
| QuickBooks/Stripe/Gmail | configure and operate integration | broad direct integrations | typed settings, OAuth/adoption, signed/queued authority | V2 IMPROVEMENT — KEEP V2 | P1 live proof |
| Portal | invoices/payments/proofs | portal dashboard, orders, quotes, docs/profile | setup/auth, invoices/payment and proofs only | MISSING — RESTORE CAPABILITY / business decision | P0/L unless portal-off launch |
| Settings | org, tax, numbering, email, payments, accounting, permissions | admin settings | typed capability-gated editors | PARITY — KEEP V2 | P1 live proof |
| Navigation | operational modules | broad V1 nav | core V2 workspaces linked; label-only items are filtered from nav | BUILT BUT UNREACHABLE / MISSING by module | P0-P2 |
| AI | assistant, parsing, automation, bug triage | V1 assistant/settings | no V2 operational surface | DEFER / POST-CUTOVER — dedicated redesign | FUTURE |

## V1 behavior deliberately not restored

- Forced every-order stage progression: V2 must support explicit, authorized workflow paths without losing financial closure.
- Mutable historic Product, Formula, Proof, and financial records: retain V2 immutable versions, evidence, and exact facts.
- Direct provider-driven staff actions: retain V2 approved/idempotent Stripe and QuickBooks queue authority.
- Client-local customer/activity projections and optimistic dashboard claims: add canonical read models instead.
- A visually persuasive but non-authoritative production calendar/Kanban.

## Evidence boundaries

Primary V1 references are `client/src/App.tsx`, `client/src/lib/titanNavigation.ts`, active pages/components, and server routes on `main`. V2 references include `v2/ui/src/VisualShell.tsx`, `App.tsx`, workspace components, `productRouting.ts`, and mounted typed routers in `v2/src/interfaces/http/app.ts`. Provider, DEV runtime, and customer-facing completion remain unproven live.
