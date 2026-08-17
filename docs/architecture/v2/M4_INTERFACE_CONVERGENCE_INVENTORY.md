# M4 Interface Convergence Inventory

## Status and scope

This is the M4 planning/audit milestone. It compares the approved Lovable
reference at `reference/lovable-ui` with the real authenticated V2 application
at `v2/ui` and its HTTP/application contracts. It is a map for small follow-on
adapter slices; it does not authorize a domain rewrite, new duplicate
persistence, deployment, or a broad UI replacement.

The authoritative reconstruction plan names the next program milestone only as
**M4 Interface convergence** (`docs/architecture/V2_RECONSTRUCTION_MASTER_PLAN.md`).
No authoritative M4 sub-number, M4 sequence, or earlier interface-convergence
plan was found in the repository as of this audit. Accordingly this document is
named **M4**, not an invented M4.1/M4.0 sub-milestone. Follow-up commits should
use focused descriptive names until the master plan establishes sub-numbering.

### Authoritative visual reference

`reference/lovable-ui` at `1019cd26` (`chore(v2): refresh lovable UI reference`)
is the approved visual and interaction reference. That commit is reachable from
the audited `v2/reconstruction` HEAD (`43d086b4`, M3 closure). The reference is
not an API implementation: its routes import `lib/mock/*` and/or the local
`app-store`. Its visual structure and intended interactions are authoritative;
its mock fields, local state, and status names are not automatically durable V2
facts.

### M0--M3 foundation already available

M0 supplies trusted-host authentication, Principal/Authority decisions,
CSRF/session scope, operation identity, and HTTP boundary rules. M1 supplies
tenant-scoped Customer/Contact compatibility reads, Product/PBV2 configuration
reads, pricing, Quotes, Orders, and Order-to-Draft-Invoice coordination. M2
supplies Artwork file/typed assignment, Proofing, Prepress required units, and
ProductionWork/immutable ProductionAttempt. M3 supplies Fulfillment handoffs,
Billing Invoice lifecycle, and immutable Payment/Refund facts.

The real HTTP composition in `v2/src/interfaces/http/app.ts` mounts authenticated
routers for quotes/customers, orders, invoices/finance, artwork, proofing,
prepress, production, and fulfillment. The selected V2 React workspaces use
those endpoints via `v2/ui/src/api.ts`; they are not Lovable mock data.

## Classification and reading rules

| Classification | Meaning used here |
| --- | --- |
| CONVERGED | Approved structure plus real V2 data/behavior are substantially integrated. |
| PARTIAL | A real V2 workspace exists, but meaningful reference visual, interaction, or projection work remains. |
| PROVISIONAL | Real functionality exists in a deliberately temporary presentation that should be replaced by the approved UI. |
| MISSING | The approved workspace exists but no equivalent routed V2 workspace exists. This says nothing by itself about the domain/backend. |
| MOCK-ONLY | Lovable presents behavior/data for which no canonical V2 contract currently exists. |
| DOMAIN DECISION REQUIRED | The proposed behavior would conflict with an established V2 owner or invariant. |
| UI PLACEMENT DECISION REQUIRED | A real/needed canonical fact has no approved Lovable placement or interaction. |

`Route` below means a user-reachable V2 visual destination, not merely a
component or an HTTP endpoint. `Read/write` means authenticated, tenant-scoped
V2 HTTP/application capability. `Data` records whether the currently displayed
workspace is real, mock, mixed, or not applicable (N/A).

## Interface convergence matrix

| Area / approved workspace | Lovable / real V2 route and UI | Read / write contract | Data now; visual and interaction convergence | Classification, owner, gap and next action | M4 dependency / evidence |
| --- | --- | --- | --- | --- | --- |
| Application shell | Yes: `_shell.tsx`; V2 has `V2VisualShell` but no URL router (in-memory page state). | N/A. | Real shell appearance, but no deep links, browser history, global search, notifications, account menu, or functional report/bug/storefront controls. | PARTIAL. UI System owns shell; converge route model and wire only approved actions backed by contracts. | Foundation before every slice. `reference/lovable-ui/src/routes/_shell.tsx`; `v2/ui/src/VisualShell.tsx`. |
| Navigation | Yes: approved shell exposes all listed workspaces; V2 sidebar exposes the labels but only ten page values navigate. | N/A. | Mixed: existing destinations are real; Products, Artwork, Routing, etc. are inert buttons. | PARTIAL. UI System owns navigation; do not imply availability merely by showing a label. Add routes only with their slice. | Shell route model; `VisualShell.tsx` page union/sections. |
| Appearance / theming | Yes: `/appearance`; V2 `appearance` page. | No server preference API; browser `localStorage` only. | V2 supports all six approved themes, density, accent, fonts, scale, color-vision and status boost in its model. Current UI omits scale/color-vision/status controls and the approved organization/user inheritance model. | PARTIAL. Settings stores preferences; UI System renders them. Keep browser-local behavior until a typed scoped preference contract exists; do not turn appearance into business state. | Safe independent UI slice after route model. `reference/.../_shell.appearance.tsx`; `v2/ui/src/appearance.ts`, `AppearanceWorkspace.tsx`. |
| Command Center | Yes: `/`; no V2 destination. | No aggregate dashboard projection. | Mock counters/queues/actions in Lovable; N/A in V2. | MISSING. Reporting/read-model owner; dashboard cannot persist copied operational status. Add only bounded, owner-projected counts after core routes. | Depends on underlying workspace projections. `reference/.../_shell.index.tsx`. |
| Customers list | Yes: `/customers`; V2 now has a URL-routed Customer catalog. | Authenticated `GET /customers` is a bounded, tenant-scoped Customer-owned list projection with canonical server-side search across active Customer and linked Contact facts. | The approved list hierarchy, search placement, table, contact summary, loading/empty/error states, and selection now use real data. Lovable rep, pipeline, task, orders, balance, and sales columns remain absent because they are mock or belong to another owner. | PARTIAL. Customers owns identity/contact; list exposes neither Customer writes nor copied Finance/Sales state. | M4 Customer catalog/detail slice. `CustomerWorkspace.tsx`; `customerRoutes.ts`; `postgresCustomerWorkspaceRead.ts`. |
| Customer detail / contacts | Yes: `/customers/$id`; V2 now supports Customer deep links from shell and Finance. | Existing authenticated `GET /customers/:customerId` was retained and expanded only with active, tenant- and Customer-scoped Contact relationships. No Customer/contact edit, add-contact, notes, task, activity, credit, or pipeline contract. | Real canonical identity/address/contact hierarchy now replaces the temporary detail. Commercial and financial context is explicitly owner-bound and directs users to existing Sales/Finance records; it does not copy mutable truth. | PARTIAL. Customers owns identity/contact. Contacts are SQL relationship scoped; Sales/Billing aggregates remain deliberately absent. | M4 Customer catalog/detail slice. `CustomerWorkspace.tsx`; `customerRoutes.ts`; `postgresCustomerWorkspaceRead.ts`. |
| Customer CRM tasks, activity, notes, rep/pipeline/credit | Shown in approved customer detail. | No V2 contract except identity/contact read; financial balances are Billing projections. | Mock-only local state in Lovable. | MOCK-ONLY for tasks/activity/notes/pipeline/rep until a Customer/CRM decision; **DOMAIN DECISION REQUIRED** if it tries to persist Billing balance/credit or Sales document truth on Customer. | Do not block the identity/detail slice. `reference/.../customers.$id.tsx`; `lib/mock/crm.ts`. |
| Products catalog/list | Yes: `/products`; V2 now has a Products shell destination and URL adapter. | Authenticated `GET /products` is a bounded, tenant-scoped Product/PBV2 catalog projection; Quote form reads remain separate. | Real active Product/PBV2 data now populates name, stable ID, measurement requirement, active configuration version, loading/empty/error states, and selection. The approved category/SKU/material columns are not invented. | PARTIAL. Products/PBV2 owns configuration. The catalog is read-only and introduces no Product persistence. | M4 Product catalog/detail slice. `ProductWorkspace.tsx`; `productRoutes.ts`; `postgresProductWorkspaceReads.ts`. |
| Product detail / Product Builder | Approved `/products/$id` and `/product-builder`; V2 now supports `/products/:productId` and browser back/forward for real detail. | Authenticated Product-owned detail projection exposes identity, measurement model, active configuration metadata/options, and current Product-Type route policy. No Product write/publish contract is exposed. | Real read-only detail converges on approved header, pricing and configuration hierarchy. Lovable material recipe, price method labels, route steps, storefront fields, and Builder edit control remain absent because their owners/contracts are not available. | PARTIAL for detail; MOCK-ONLY for Builder mutations. Products/PBV2 owns Product configuration; Routing owns route templates; Settings/Portal owns storefront settings. | Product route adapter persists active organization in session storage only (never authority) so refresh retains its destination after authenticated bootstrap. `productRouting.ts`, `ProductWorkspace.tsx`, `products.$id.tsx`. |
| Quotes | Yes: `/quotes`, `/sales/$id`; V2 `quotes` list/detail/form. | Authenticated list/read/create/patch/send/convert and Product configuration resolution. | Real V2 data and mutations, but presentation is a temporary table/form rather than approved work-grid and sales document UX; reference is mock. | PARTIAL. Sales owns commercial truth. Converge layout and links without changing quote lifecycle/pricing authority. | After Product read adapter. `App.tsx`, `quoteRoutes.ts`, `sales.$id.tsx`. |
| Orders | Yes: `/orders`, `/sales/$id`; V2 list/detail. | Authenticated list/read/create/patch; canonical generated Draft Invoice and Routing context. | Real V2 data and line mutations; approved detail/list interaction is not reproduced, and Notes/History tabs are labels only. | PARTIAL. Sales owns commercial truth; Routing owns route position. Use read projections for real history; do not add browser-local order status. | After quote convergence. `OrderWorkspace.tsx`; `orderRoutes.ts`. |
| Invoices list/work grid | Yes: `/invoices`; V2 Finance Invoice mode. | Authenticated Invoice list/read/issue and finance overview. | Real V2 data, links, lifecycle/settlement separation, sortable/resizable/reorderable work-grid in Finance workspace. V2 does not have URL invoice detail or server-synced grid preferences. | PARTIAL. Billing owns Invoice facts; keep grid preferences local until a scoped settings contract. | Low-risk visual polish after current core slices. `FinanceWorkspace.tsx`; `invoiceRoutes.ts`; `financeRoutes.ts`; `components/app/work-grid.tsx`. |
| Invoice detail | Yes: `/invoices/$id`; Finance side detail and older `InvoiceWorkspace` component, not URL-routed. | Authenticated Billing read/issue; Finance detail exposes totals and history. | Real lines/totals/links and issue; approved full detail placement, due-date/number/send/PDF controls are not all contract-backed. | PARTIAL. Billing owns issued checkpoint; human number, Void, delivery/PDF are deferred, not UI gaps. | Depends on shell URL route; `invoices.$id.tsx`; `FinanceWorkspace.tsx`; `M3_BILLING_INVOICE_UI_API.md`. |
| Payments and refunds / global ledger | Yes: `/payments`; V2 Finance ledger mode. | Authenticated ledger/financial Invoice read and payment/refund record operations. | Real immutable Payment/Refund history, Total/Paid/Refunded/Balance, invoice/order/customer links, method, reference, invoice total, and balance-after are present; reference work-grid shell is closer than most areas. | CONVERGED. Billing/Payments owns immutable facts. Keep provider recovery/reconciliation immutable; adapter/card UI is deferred. | Maintain with finance regression coverage. `FinanceWorkspace.tsx`; `financeRoutes.ts`; `payments.tsx`. |
| Artwork | Yes: `/artwork`; no standalone V2 route (only an Order Artwork tab). | Authenticated order artwork read and typed file assignment. | Real assignment contract exists; approved Artwork queue/file UI is mock and V2 has no visual entry point. | MISSING. Artwork owns one durable file identity and typed usages. Add a routed read/assignment workspace; never split customer/production/proof/prepress files into separate core universes. | After Product/Customer read slices. `artworkRoutes.ts`; `OrderWorkspace.tsx`; `artwork.tsx`. |
| Design workstation | Yes: `/design`; no V2 UI/contract. | No V2 Design domain contract. | Mock jobs, versions, timers, costs, notes. | MOCK-ONLY. A Design owner/relationship to Artwork/Production has not been established. | Excluded unless a named M4 contract decision is made. `design.tsx`. |
| Proofing | Yes: `/proofing`; V2 `proofing` page. | Authenticated queue/read/start/version/issue/respond. | Real work/version/response and immutable Artwork evidence; layout is a lean adapter, renders no file preview, and recipient/delivery controls are mock/deferred. | PARTIAL. Proofing owns decisions only. Proof approval must not advance Prepress, Production, or Routing. | Visual convergence after Artwork entry route. `ProofingWorkspace.tsx`; `proofingRoutes.ts`; `proofing.tsx`. |
| Prepress | Yes: `/prepress`; V2 `prepress` page. | Authenticated queue/coverage/units/open/start/complete. | Real frozen required units and Prepress actions; previews, notes/flags, material, production plan and alerts are explicitly absent/deferred. | PARTIAL. Prepress owns execution; Product/PBV2 owns required units; Production/Routing own their facts. | After Artwork/Proofing integration. `PrepressWorkspace.tsx`; `prepressRoutes.ts`; `prepress.tsx`. |
| Production Overview | Yes: `/production`; V2 Production overview. | Authenticated Flatbed/Roll queues, work read/open/start/output/complete. | Real V2 work/attempt data, summary, board and intentionally read-only calendar. Mock schedules/machine load/Kanban state are not facts. | PARTIAL. Production owns work/attempts; retain output as operational context only. | Existing production slice can receive visual polish after core routing. `ProductionWorkspace.tsx`; `productionRoutes.ts`; `production.tsx`. |
| Flatbed Production | Approved as production station view; V2 station tab. | Same Production contract, station=`flatbed`. | Real queue and mutations; missing print ticket, pause, waste, notes, reassignment/scheduling. | PARTIAL. Production owns attempts; some controls are future contracts, not inert UI to persist. | Depends on scheduling/attempt extension decisions. `ProductionWorkspace.tsx`. |
| Roll Production | Approved as production station view; V2 station tab. | Same Production contract, station=`roll`. | Same as Flatbed; real queue and attempt actions. | PARTIAL. Production owns attempts. | Same as Flatbed. `ProductionWorkspace.tsx`. |
| Routing | Yes: `/routing`; no V2 route/workspace. | Routing module/domain exists and Sales creates route context; no authenticated Routing workspace contract. | Lovable route-template edit/list state is mock; V2 Order can display a compact route summary only. | MISSING. Routing owns templates, instances, steps and position. Add a read-first projection only after a Routing workspace contract; do not duplicate route status in operations. | Requires small contract B/C decision. `routing.tsx`; `M1_ROUTING_IDENTITY.md`; `OrderWorkspace.tsx`. |
| Fulfillment | Yes: `/fulfillment`; V2 `fulfillment` page. | Authenticated list/order read/availability/pickup/shipment operations. | Real tenant-scoped handoff history and exact-quantity pickup/shipment; approved shipping-label/carrier presentation has no V2 backing. | PARTIAL. Fulfillment owns completed legitimate handoffs. Never cap fulfillment by produced quantity. | Visual convergence independent of carrier integration. `FulfillmentWorkspace.tsx`; `fulfillmentRoutes.ts`; `fulfillment.tsx`. |
| Shipping | Yes: `/shipping`; no V2 route. | Shipment handoff exists within Fulfillment; no carrier/package/tracking adapter contract. | Lovable shipment list/status/mock tracking. | MISSING for placement; carrier behavior is intentionally deferred. Fulfillment owns handoff, Integrations owns external carrier transport. | Do not create a second shipping state. `shipping.tsx`; `fulfillmentRoutes.ts`. |
| Inbound Orders | Yes: `/inbound`; no V2 V2 route. | No final-submission interface adapter in current audited app. | Lovable review queue is mock. | MISSING. Inbound owns ingestion/review; final Quote/Order/Artwork actions must call named canonical operations. | Later M4 interface adapter, after sales routes. `inbound.tsx`. |
| Inventory, Materials, Procurement, Nesting | Approved `/inventory`, `/materials`, `/procurement`, `/nesting`; no V2 workspace. | No V2 contract reviewed that supports these screens. | Lovable mock data and controls. | MOCK-ONLY / intentionally deferred. Inventory and procurement are deferred program capability, not an M4 screen gap. | Excluded. `inventory.tsx`, `materials.tsx`, `procurement.tsx`, `nesting.tsx`. |
| Reports | Yes: `/reports`; no V2 route. | No reporting projection contract. | Mock sales/AR/station metrics. | MOCK-ONLY. Reporting owns non-authoritative read models; it must not write operational truth. | Excluded except bounded Command Center projections. `reports.tsx`. |
| Communications | Yes: `/communications`; no V2 route. | No Delivery/Communications contract. | Mock delivery/thread state. | MOCK-ONLY and intentionally deferred. Communications will own delivery/view facts, not Invoice/Proof lifecycle. | Excluded. `communications.tsx`. |
| AI Assistant | Yes: `/assistant`; no V2 UI route. | M0 architecture permits scoped Plan/GO, but no audited staff UI adapter. | Mock conversation/control state. | MISSING interface adapter; not a domain gap. AI must invoke canonical operations under revalidated authority. | Later M4 after stable operation DTOs. `assistant.tsx`; master plan Interfaces section. |
| Service/Storefront | Approved `/storefront/$slug`; no V2 UI route. | No audited Portal/Service DTO adapter. | Mock customers/products/checkout. | MISSING interface adapter, with Product/Customer/Sales dependencies. Portal must not implement alternate pricing, proof, billing or authority rules. | Later M4; not first slice. `storefront.$slug.tsx`. |
| Settings, users, integrations, bug reports | Approved `/settings`, `/users`, `/integrations`, `/bugs`; no V2 routes. | No audited V2 UI contracts for these screens. | Lovable mock/local state. | MOCK-ONLY except shell placement. Settings/Authentication/Integrations/Bug Reporting are named owners but their staff adapters are later work. | Excluded from immediate convergence. respective reference routes. |

## M4 Artwork / Proofing / Prepress implementation update

* **Artwork — PARTIAL:** `/artwork` now exposes a bounded, authenticated, tenant-scoped catalog of canonical Artwork files through their real typed assignments. It shows file identity, Order/line context, purpose, side/page/layer, and derived-file lineage without creating a duplicate file or queue table. Upload, replacement, and assignment controls remain absent because their complete approved placement is not established.
* **Proofing — PARTIAL:** `/proofing` is now restored by the shared client route adapter. Its existing real queue, immutable ordered ProofVersions, exact Artwork evidence, feedback history, and strict Proofing-only decision boundary remain intact. Renditions, recipients, delivery/viewed state, and Communications history are deferred.
* **Prepress — PARTIAL:** `/prepress` is now restored by the shared client route adapter. Its existing frozen required units, exact production-Assignment coverage, missing-unit presentation, and unit-scoped operations remain intact. Preview, notes/flags, material, planning, and Production alerts remain explicitly unavailable/deferred.

## M4 Quotes / Orders implementation update

* **Quotes — PARTIAL:** `/quotes` and `/quotes/:quoteId` now use the shared client route adapter. The existing server-side search, lifecycle filters, cursor pagination, authenticated detail/editor, Product/PBV2 configuration, Pricing, authorized overrides, stale-state refresh, Send, Accept, and conversion operations remain unchanged. The catalog/detail hierarchy now identifies the Sales workspace and keeps those operations server-authoritative.
* **Orders — PARTIAL:** `/orders` and `/orders/:orderId` now use the shared client route adapter. The existing canonical list, frozen commercial detail, Draft Invoice projection, read-only Routing context, Artwork context, and approved Sales mutations remain unchanged. Billing settlement/detail, mutable Routing controls, and mock Notes/History/activity remain deliberately absent.
* These routes retain active organization only in client session storage after authenticated bootstrap; it is never authority. Production static hosting still needs SPA history fallback for direct refresh.

## M4 Finance / Fulfillment / Production implementation update

* **Finance — PARTIAL:** `/invoices`, `/invoices/:invoiceId`, and `/payments` are now restored by the shared client route adapter. Invoice selection is URL-addressable, and the existing canonical Invoice detail retains lines, totals, derived settlement, immutable Payment/Refund history, Issue, Take Payment, and Refund operations. Invoice and ledger rows now route to the canonical Invoice; Invoice links to canonical Order and Customer routes. Provider references, human invoice numbers, Void, PDF, delivery, credits, rebills, and adjustments remain deferred.
* **Fulfillment — PARTIAL:** `/fulfillment` and `/fulfillment/orders/:orderId` now provide stable destinations for the existing authenticated order projection, partial pickup/shipment operations, and immutable handoff history. Order-to-Fulfillment navigation is canonical. Remaining quantity remains ordered quantity minus completed legitimate handoffs; Production output is explicitly context only, never an authorization ceiling. Carrier purchase, labels, tracking, and external transport remain deferred.
* **Production Overview / Flatbed / Roll — PARTIAL:** `/production`, `/production/flatbed`, and `/production/roll` restore the real overview and selected station composition. Flatbed/Roll retain Next up, station-selected first start, immutable attempts, partial output, completion, reprints, and exact Artwork evidence. Scheduling, machine reservations/load, Kanban movement, pause, waste, notes, and print-ticket lifecycle remain unavailable rather than browser-local mock state.
* The existing Vercel catch-all rewrite already supplies SPA history fallback for these client routes; no deployment configuration was changed.

## Contract disposition

## M4 Routing / Inbound / Portal / AI adapter update

## M4 closure update

* **Command Center — PARTIAL:** `/` now composes bounded Sales Quote/Order and Billing Finance overview projections under their existing read capabilities. It is read-and-navigate only and persists no dashboard facts.
* **Shell / Appearance — PARTIAL:** the shell routes Command Center and Appearance, hides deferred navigation rather than presenting inert destinations, and browser-local Appearance now exposes scale, color-vision, and status emphasis alongside the existing themes, density, corners, accent, and fonts.
* **Readiness:** the real staff workflow is coherent through Customer/Product → Quote → Order → Invoice/Routing → Artwork → Proofing → Prepress → Production → Fulfillment → Payments. M4 is complete with explicitly deferred domain-capability work; M5 is Shadow/parity per the master plan.

* **Routing — PARTIAL:** `/routing` is now a tenant-scoped, capability-checked (`route.view`) read-first workspace backed by canonical Route Template and frozen Route Instance persistence. It displays ordered template steps, frozen source revision/fingerprint, current Routing-owned position, and canonical Order links. Template editing, reroute, skip, and route progression remain unavailable because the Routing module deliberately exposes no corresponding named operation.
* **Inbound — DOMAIN CAPABILITY REQUIRED:** canonical, authenticated internal ingestion/review records and an existing staff workspace exist in the legacy `server/`/`client/` composition, but no V2-owned adapter delegates final candidate submission through the V2 Customer/Sales/Artwork operations. No V2 `/inbound` route is added until that narrow integration boundary is defined; mock acceptance state is not reproduced.
* **Portal / Service — DOMAIN CAPABILITY REQUIRED:** V2 has Portal Principal/permission-set/ceiling authority foundations, but has no Portal session runtime, safe customer-scoped storefront read DTO, canonical storefront slug, or customer-facing Product/Pricing/Sales composition. No public/storefront route is added and Staff APIs are not reused as a portal substitute.
* **AI Assistant — DOMAIN CAPABILITY REQUIRED:** V2 has delegated-AI authority revalidation and canonical-operation attribution foundations, but no named AI read/tool map, command integration, durable Plan/GO confirmation record, assistant runtime, or staff API. No `/assistant` route is added; the Lovable local mock plan/GO behavior is not persisted or imitated.

The matrix distinguishes missing UI from missing backend:

| Disposition | Items | Result |
| --- | --- | --- |
| A. Existing contract; frontend wiring/presentation missing | Customer detail read, Product form/configuration reads, Quotes, Orders, Artwork assignment, Proofing, Prepress, Production, Fulfillment, Finance. | Build adapters/routes against the existing contracts first. |
| B. Small read-projection expansion likely needed | Customer list/detail relationships, Product catalog/detail projection, Routing workspace, Command Center counts, URL-oriented Invoice detail. | Define bounded typed read models with provenance; no duplicate persistence. |
| C. Small new integration contract genuinely needed | A scoped preference API (only when local persistence is no longer sufficient), Inbound final submission adapter, Portal/Service DTOs, AI workspace adapter. | Add after their owner operation/authority rules are explicit. |
| D. Architecture conflict / decision gate | Customer mock balance/credit ownership, Design workstation, mutable scheduling/Kanban, carrier state, route state outside Routing. | Do not wire mock controls until ownership is decided. |
| E. Intentionally deferred | Provider adapter/card tokenization, human invoice numbers, Invoice Void, credits/rebills/adjustments, delivery/PDF, QuickBooks, external carriers, server-synced grid preferences, inventory/production enhancements. | Label honestly; do not classify these as missing persistence defects. |

## Mock-only elements and canonical owners

* Customer identity and Contacts belong to Customers. Customer notes/tasks/activity/pipeline need an explicit CRM decision; balances/credit remain Billing projections and commercial documents remain Sales facts.
* Product configuration belongs to Products/PBV2; price evaluation belongs to Pricing. Route template/position mock controls belong to Routing, and storefront flags/configuration belong to Settings/Portal.
* Invoice lifecycle and issued snapshot belong to Billing. `Paid`, `Partially Paid`, and `Unpaid` are derived settlement projections, not persisted Invoice lifecycle values. Payments/Refunds remain immutable money-movement facts.
* Artwork preview/assignment belongs to Artwork with one durable file identity and typed uses. Proofing owns proof response; it does not move Prepress/Production/Routing.
* Required production units are frozen Product/PBV2 commercial truth. Prepress must not infer them from artwork. Production owns work/attempt/output; output is never Fulfillment authority.
* Fulfillment owns completed customer handoffs. Carrier transport is an Integrations concern; produced quantity is context, not a handoff limit.
* Scheduled boards, machine reservations, capacity, pauses, and Kanban movement require a Production/Routing scheduling decision. Do not make browser state authoritative merely to match the mock.

## Known architecture/UI conflicts

1. The Customer mock presents balance, credit, sales, and activity as editable account context. Billing and Sales retain those owners; customer presentation must consume projections rather than save copies.
2. Lovable Finance correctly displays a separate settlement concept. The real adapter must preserve that separation and never persist settlement labels as Invoice lifecycle.
3. Lovable Production/Prepress/Proofing includes controls that could imply downstream status transitions. The V2 workspaces correctly prevent Proof approval, Prepress completion, and Production output from advancing unrelated owner state.
4. Lovable Fulfillment/Shipping must not introduce a produced-quantity cap or a parallel shipment status. The handoff ledger remains the availability authority.
5. Lovable Artwork organization must map to typed assignments of one file identity, not separate Customer Art/Production Art/Proof Art/Prepress Art tables or IDs.

## Missing frontend routes and incomplete integration surfaces

The immediate missing real routes are: Command Center, Customer list, Product list/detail/builder, standalone Artwork, Routing, Shipping, Inbound, Design, Inventory/Materials/Procurement/Nesting, Reports, Communications, Assistant, Storefront, Settings, Users, Integrations, and Bug Reports. Existing pages should become URL-addressable as the shell route model is introduced; this is separate from their domain contracts.

The most useful next read contracts are Customer-list and Product-catalog/detail projections. Neither requires a new business owner or mutable table. Routing requires an explicit workspace projection decision because the reference edits templates and V2 must not expose a partial mutation model that bypasses Routing authority.

## Excluded deferred work

M4 convergence explicitly excludes live payment-provider adapters, card/tokenization UI,
human Invoice numbers, Invoice Void, credits, rebills, adjustments/corrections,
Delivery/Communications, Invoice PDF, QuickBooks/accounting integration, deeper mobile
hardening, server-synced grid preferences, external carriers, and intentionally deferred
Inventory/Production enhancements. A reference control may be styled as unavailable or
omitted; it must not be backed by fake state.

## Recommended M4 implementation sequence

1. Introduce a small URL route adapter around the existing V2 shell, preserving the current authenticated bootstrap/session invalidation behavior. Do not turn every sidebar label into a working placeholder.
2. **First implementation slice: Product catalog read-only convergence.** Add a Products destination matching the approved catalog/list and a selected detail read view backed by a bounded Products/PBV2 projection (adapt the existing authenticated product/configuration reader where sufficient). Include real data, tenant scope, direct deep link, and no write/publish controls. This closes the known missing Product route without reopening the Product domain or inventing state.
3. Replace the provisional Customer detail with the approved information architecture using the existing canonical read; add an explicit Customer list projection and only identity/contact actions that have a named Customer contract. Keep Sales/Billing summaries read-only projections or defer them.
4. Add a standalone Artwork queue/detail adapter over the existing file/typed-assignment contract, then visually converge Proofing and Prepress around the same evidence model.
5. Converge Quote/Order workspaces and links to the approved sales document/work-grid patterns, retaining Sales/Pricing/Routing ownership.
6. Complete Finance deep-linking and visual polish, then Fulfillment/Production presentation. Treat provider/carrier/scheduling controls as excluded unless their owner contracts arrive.
7. Address Routing, Inbound, Portal/Service, and AI only through named scoped integration DTOs. Add Command Center/read-model projections last, once underlying destination links are real.

This order favors route-by-route, real-data, testable slices. It also makes Customer and Product progress visible early while avoiding a giant shell rewrite.

## Validation record for this audit

* Static: inspected master-plan M4 numbering, M0--M3 architecture documents, reference route inventory, V2 React routes/workspaces, V2 HTTP routers, API client contracts, and Product compatibility reader. Confirmed `1019cd26` is reachable from audited HEAD. The Product workspace slice adds focused HTTP, PostgreSQL-projection, and URL-parser coverage; no Product write endpoint or schema change was added.
* Local review safety: the pre-existing worktree contains exactly two modified, uncommitted files: `v2/scripts/m175bBrowserHost.ts` and `v2/ui/src/App.tsx`. The host modification only executes inside the `V2_M175B_BROWSER_TEST=1` branch (where the fixture exists), injects `organizationA`, and establishes `staff-a` only for that local browser host. Without the environment flag, the fixture branch and injected `window.__V2_LOCAL_REVIEW__` bootstrap do not exist; the UI helper returns an empty organization ID. These files are out of scope for this document and must remain unstaged.
* Automated: focused Product projection/HTTP tests and V2 UI routing tests pass. The Customer slice adds Customer HTTP projection, PostgreSQL relationship-scope, and shared Product/Customer URL-adapter coverage. V2 TypeScript checks, UI build, and import-boundary validation are required before release.
* Clone, Playwright/browser, visual, DEV, and MAIN validation: not run for the Product slice because this workspace has neither `TEST_DATABASE_URL` nor `V2_POSTGRES_INTEGRATION=1`; the clone/browser host therefore remains intentionally fail-closed. No deployment occurred.
