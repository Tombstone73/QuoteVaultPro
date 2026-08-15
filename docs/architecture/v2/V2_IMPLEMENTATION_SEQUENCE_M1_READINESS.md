# V2 Reconstruction Implementation Sequence / M1 Readiness

## Executive recommendation

Build M1 as a staged **commercial spine**, not a single Create Order feature and not a shared-environment writer. The sequence is:

    M0 physical readiness
      -> commercial contracts and characterization
      -> Pricing parity
      -> Product/CRM compatibility reads and bounded Staff authority
      -> permission-set foundation and commercial persistence
      -> Quote slice
      -> minimal Routing identity
      -> Order + Draft Invoice slice
      -> Quote conversion
      -> shared Sales UI, shadow/parity, and a separate cutover decision

**M1 clone/isolated-DEV implementation writing is not ready to begin now.** Two M0 closure gates remain open, and the remaining entry checklist in section 13 is intentionally NO until they and the listed contract decisions pass. It never authorizes shared-DB DEV or production writing, or the M6 Sales/Billing domain cutover.

## 1. Open M0 preconditions

1. `npm run db:migrations:v2:preflight` currently passes journal monotonicity but fails the protected migration-history integrity check. `server/db/migrations_v2/meta/_history-integrity.json` protects history through 0178 while the journal contains 0179 and M0 0180; the protected digest itself mismatches. It needs forensic reconciliation and an approved append/refresh policy, not a blind manifest refresh.
2. M0 clone safety and catalog checks exist (`v2/infrastructure/persistence/cloneSafety.ts` and `physicalPostconditions.ts`), but no authorized fresh DEV-shaped clone has yet applied the immutable stream and proved real catalog postconditions. Unit/mock coverage is not clone evidence.

Before commercial persistence or any M1 writer: resolve the integrity discrepancy; use an explicitly authorized disposable `TEST_DATABASE_URL` with `V2_M0_POSTGRES_INTEGRATION=1` and no other DB URL; apply the immutable migration stream; prove M0 physical catalog findings; then run transaction/idempotency/outbox failure tests. Inventory and suppress/sandbox every legacy worker, scheduled job, webhook, outbox consumer, provider credential, and external transport reachable from legacy commercial tables; clone evidence must assert that no external transport occurred.

## 2. Early dependency graph

| Area | Dependency | M1 treatment |
| --- | --- | --- |
| M0 operation requests, attribution, durable work | Hard | Close physical/clone gates; reuse generic M0 identity, never create an Order-specific idempotency system |
| Pricing/PBV2 | Hard for price-bearing writes | First M1 implementation slice; clean DTOs, pure adapter, parity fixtures |
| Customers/CRM | Hard reference, not writer | Organization-scoped compatibility reader |
| Products/PBV2 configuration | Hard reference, not writer | Sellable Product/active configuration compatibility reader |
| Permissions | Hard for writer/cutover; soft for read-only contract work | Bounded Staff compatibility issuer first; full set persistence before broad writer/cutover |
| Sales and Billing | Hard, coordinated | One atomic Order -> Draft Invoice operation; payment/refund defer |
| Routing | Hard for routable Order writes | Minimal template revision/instance port; transitions defer |
| Audit/History | Hard for mutations | M0 attribution plus meaningful Sales/Billing/Routing events |
| UI System / Assets | Soft / deferred | Tokens/components after DTO stability; no Artwork/file ownership in M1 |

Products and CRM can safely remain V1 writers while V2 uses read-only compatibility repositories. Pricing can calculate through compatibility reads before Products publishing moves to V2. Draft Invoice creation is required with V2 Order creation, but payment/refund/provider work is not.

## 3. Refined M1 scope

M1 is the smallest coherent commercial spine:

- scoped Customer/Contact and sellable Product/active PBV2 compatibility reads;
- `ResolvedProductConfiguration`, `Pricing.calculate`, `PricingResult`, and calculated-price versus Sales selling-price decision;
- Quote current state, send checkpoint, and Quote -> Order conversion that preserves the original Quote;
- direct Order current state, atomic Draft Invoice creation, explicit Draft synchronization, and Issued boundary;
- M0 request idempotency, attribution, Audit, and authority tests;
- minimal routable-work-item/Route Instance creation for routable Order lines;
- stable Sales read DTOs and a shared Quote/Order workspace after the backend slice.

M1 excludes Product/PBV2 publishing, CRM writing, Recipe/BOM, stock/reservations, Artwork/Proof, Prepress/Production transitions, Fulfillment/Shipping, payments/refunds, provider side effects, routing UI/reroutes, Portal/Inbound/AI mutation adapters, and broad permission administration UI.

## 4. Compatibility and ownership strategy

### Pricing / PBV2

Pricing work is the first implementation slice **inside M1** after M0 closure. Define `SellableProductConfiguration`, `ResolvedProductConfiguration`, `Pricing.calculate`, `PricingResult`, rounding/precedence, and immutable pricing evidence. Use the proven persistence-free evaluator and selected helpers only behind the new contract; do not reuse `PricingService.priceLineItem` as a boundary. Freeze golden fixtures for per-square-foot, per-piece, quantity, tiers, matrices, formulas, option impacts, minimums, and rounding. Sales consumes a result and owns the authorized SellingPriceDecision; it never evaluates PBV2.

### Permissions

Use a constrained temporary compatibility adapter: server-side V1 organization membership maps to explicitly approved per-operation typed V2 Staff capabilities for contract work, clone writers, and limited Staff-only development. It resolves at request time, is feature-flagged/expiry-bound, has a named removal milestone and negative-scope/retirement tests, and is never accepted by shared-DB/cutover endpoints. It never accepts `users.isAdmin`, global role/platform flags, or UI claims as tenant authority. Normalized permission sets, assignment/effective-resolution revisions, and transactional lockout protection must exist before broad V2 writer/cutover. Portal, Service, and broad delegated-AI mutation wait for their explicit scope models.

### Product and CRM

Products remains the V1 writer. A V2 read-only repository validates organization, active/sellable lifecycle, Product Type, active PBV2 association, and maps legacy representations to one DTO; it imports no V1 route/service/repository. CRM remains the V1 writer. A V2 reader resolves scoped customer/contact/address identity. Sales retains references, not a mutable CRM copy; historical names/addresses exist only inside sent Quote/issued Invoice checkpoints.

## 5. Sales, Billing, and commercial history model

Use existing `quotes`, `quote_line_items`, `orders`, `order_line_items`, `invoices`, and `invoice_line_items` behind scoped compatibility repositories. Existing links (`orders.quote_id`, `quotes.converted_to_order_id`, `invoices.order_id`) and duplicated financial/header fields are temporary compatibility facts, not V2 ownership proof. Do not normalize them broadly or backfill legacy history.

One application-level owner applies to each current fact. An editable Quote owns its current facts. Conversion preserves a sent/accepted Quote checkpoint and creates a separate editable Order current state; it never synchronizes historical Quote state. Shared command/DTO/workspace fields cover customer/contact, PO, requested due date, sales context, and lines without requiring immediate schema replacement. Quote expiration, Order operational due date, and Invoice payment due date remain distinct lifecycle facts.

Billing creates exactly one current Draft Invoice for a newly created Order in the same transaction. Commercial Order edits invoke a Billing draft-sync operation; Billing owns its lines/header math. Issuance creates an explicit immutable financial/document checkpoint and stops silent Order synchronization. Existing `invoice_version`, sent fields, and `invoice_line_items` are not sufficient issued-checkpoint evidence. Early operations write only approved module-owned rows/compatibility columns through module repositories; no compatibility repository may recalculate a foreign Sales/Billing rule or treat duplicated legacy columns as independent truth. Tests reject writes outside that contract. Do not implement payments/refunds in M1.

Minimum quote history is current Quote plus immutable data/evidence at send, accept, and conversion, correlated to pricing and SellingPriceDecision. Conversion uses a qualifying checkpoint or atomically creates a conversion checkpoint from the current Quote; whether unsent conversion is allowed is an open product decision. Sent/accepted/converted Quote and Issued Invoice checkpoints retain resolved configuration, pricing inputs/result, SellingPriceDecision/override authority, tax/terms/currency/rounding, and necessary customer/address presentation references. Do not create a revision for normal edits.

## 6. Minimal Routing dependency

M1 must not postpone routable identity until Production. Before a routable V2 Order writer exists, Routing supplies a minimal port that resolves an explicit active template revision and atomically creates a frozen work item/Route Instance for each applicable non-parent line. It reads the Product-Type -> template association as one validated compatibility result in the same transaction/snapshot, fails closed if absent/retired, and persists the revision. Printed/static templates are explicit; Quote has no route; service/fee normally has none. No name inference, PBV2 routing tags, transitions, reroutes, skip UI, Proof/Prepress/Production integration, or combined-run behavior belongs in early M1.

## 7. UI and deployment sequence

Do not deploy a cosmetic shell. The first useful `v2-dev.printershero.com` / `api-v2-dev.printershero.com` deployment follows stable Sales read DTOs, Pricing preview parity, and one thin Quote or Order vertical slice. In shared DEV it is side-by-side, read-only/shadow and clearly labeled; it cannot dual-write. Clone or explicitly isolated V2 DEV may exercise the writer. Shared V2 writes wait for a Sales/Billing single-writer cutover.

Reuse the current React toolchain, app shell, selected layout/components, and semantic UI System tokens, but create a dedicated V2 route tree and V2 API/DTO client. Do not inject V2 mutations into the monolithic V1 `App.tsx` route tree or copy direct `/api/quotes/*` and `/api/orders` forms.

First workspace: one `SalesWorkspace(documentKind=quote|order)` with common header/status, redesigned company/contact block, customer/contact/sales/PO/due-date fields, lines, calculated result versus SellingPriceDecision, notes/files read projections, checkpoint timeline, and capability-driven controls. Quote-only actions are send/convert; Order-only presentation is a linked Draft/Issued Invoice summary. “Take Payment” stays on Billing. Defer PBV2 authoring, payment, Artwork, production panels, advanced alternatives, Portal, and theme/editor polish.

## 8. Characterization, parity, migration, and clone plan

Before writers, freeze Pricing fixtures and Sales/Billing behavior contracts. Clone-backed PostgreSQL tests must cover two organizations, scoped customer/product/PBV2 reads, Quote create/edit/send, direct Order, Quote conversion/no reprice, original Quote preservation, Draft creation/sync, Issued no-silent-change, calculated/selling price lineage, Staff/AI/Portal/Service matrices, no fake Staff, idempotency replay/payload conflict, tenant isolation, concurrent duplicate submission, and injected failure after request claim/order/line/invoice/invoice-line.

Reuse high-value behavior evidence such as `PricingService.goldenRegression.test.ts`, `PricingService.pricingMatrix.test.ts`, formula/snapshot tests, PBV2 adapter tests, `quoteConversionAtomicity.contract.test.ts`, `orderInvoiceFinancialIntegrity.contract.test.ts`, and POC atomic/conversion evaluations. Recast route-wiring tests as V2 operation contracts.

Likely additive persistence--only after M0 closure and detailed design--is: commercial checkpoint/pricing-evidence/linkage records; an enforced one-current-Draft-Invoice-per-Order invariant; minimal Route Template/revision/Instance identity; and permission-set/assignment revisions. Use M0 operation requests rather than another idempotency table. Every migration is append-only, preflighted, clone-rehearsed, physically verified, and failure/concurrency tested; no startup DDL, wholesale normalization, or legacy backfill.

## 9. Cutover model

1. V2 scoped compatibility reads.
2. Read-only Pricing/eligibility shadow comparisons and drift classification.
3. Disposable-clone writer with distinct credentials, no external side effects, and rollback/failure/concurrency proof.
4. Explicit isolated V2 DEV writer, with distinct configuration/credentials and no shared-DB fallback, for a gated V2 workflow only.
5. M6 Sales/Billing cutover only: create a signed inventory of every V1 Sales/Invoice mutation route, Portal/Inbound/AI/admin/batch path, worker, webhook, and consumer; positively prove each legacy mutation path is denied/disabled before enabling V2 as sole writer.
6. Retain V1 historical reads as compatibility projections and reconcile M0 operation/outbox records.

There is never uncontrolled dual writing of Orders, Draft Invoices, checkpoints, or route identity.

## 10. Detailed implementation prompts

| # | Milestone / purpose | Dependencies and scope | Non-goals / validation | Migration, clone, UI, model |
| --- | --- | --- | --- | --- |
| 0 | M0 physical readiness closure | Reconcile integrity failure; authorized clone migration/catalog rehearsal | No commercial code; preflight, real postconditions, persistence tests | Possible repair only after review; clone required; no UI; high reasoning |
| 1 | Commercial contracts and characterization | DTOs, invariants, fixture taxonomy, parity classifier | No writer/migration; contract review/tests | No; no clone; no UI; high |
| 2 | Pricing parity adapter | Scoped inputs, pure evaluator adapter, result/evidence and fixture parity | No Sales persistence; golden parity | No; clone read parity useful; no UI; high |
| 3 | Customer/Product compatibility reads | Scoped CRM/Product/active-PBV2 readers and lifecycle validation | No Product/CRM writer or V1 imports | No; clone read tests; no UI; medium |
| 4 | Temporary Staff authority compatibility | Issuer mapping, capability/negative scope/retirement tests | No global admin fallback/Portal/Service | No; clone tests; no UI; high |
| 5 | Permission-set foundation | Sets, assignments, revisions, effective authority, lockout contract | No switchboard/Portal self-admin | Likely additive; clone required; no UI; high |
| 6 | Commercial persistence design | Checkpoint/linkage repositories and migration/postcondition design | No broad normalization/writer | Likely additive; clone required; no UI; high |
| 7 | Quote vertical slice | Create/edit Quote, price decision/evidence, send checkpoint, audit/idempotency | Clone-only writer; no Order conversion UI | Possible prior migration; clone required; no UI; high |
| 8 | Minimal Routing identity | Templates/revisions, Product Type validation, work item/instance creation port | No transition/reroute/operations UI | Likely additive; clone required; no UI; high |
| 9 | Order + Draft Invoice | Atomic direct Order, Draft Invoice creation/sync, route instantiation, audit/outbox | No payment/refund/provider execution; clone-only writer | Possible prior migration; clone required; no UI; high |
| 10 | Quote conversion | Preserve Quote/checkpoint, no reprice, create Order/Draft/Route atomically | No alternatives UX; concurrency/idempotency proof | No new unless proven; clone required; no UI; high |
| 11 | Shared Sales workspace and evidence | V2 DTOs/route tree/workspace, side-by-side read/shadow, clone E2E | No shared-DEV writer before cutover | No; clone E2E; useful separate DEV read UI; medium |

Estimate: **12 prompts including M0 closure (0–11)**. Each ends in a reviewable commit and stable architecture checkpoint.

## 11. Broader reconstruction after M1

1. Product/PBV2 publishing plus Recipe/Inventory foundations.
2. Artwork/Proof, Prepress, Routing transitions, Production and Nesting/combined-run contracts.
3. Fulfillment, Shipping, Billing payment/refund/provider recovery.
4. Procurement and material replenishment.
5. Canonical Portal, Inbound, AI, and Service adapters over completed operations.
6. Communications and integration reconciliation.
7. Reporting/Search projections, Bug Reporting, and UI refinement.

Do not block M1 on Recipe/BOM, stock, Nesting, Onyx/Illustrator, full Routing UI, production/fulfillment/shipping, payments/refunds, storefront branding, Search, Reporting, Procurement, Installation, Bug Reporting, Portal self-admin, or broad AI/Inbound mutation.

## 12. Risks and open decisions

Highest risks are M0 false readiness; Pricing drift or reuse of V1 orchestration; temporary authority mapping becoming permanent; missing route identity at Order create; competing Order/Invoice truth; compatibility adapters leaking V1 business logic; dual writes; and UI preceding stable DTOs.

Open decisions: exact one-Draft invariant and issued-invoice correction semantics; exact checkpoint shape/pricing lineage; initial route-template association and static template availability; permission-set migration timing relative to isolated Staff clone flow; commercial field ownership across legacy physical duplicates; and whether V2 DEV can be isolated before shared Sales cutover.

## 13. Exact clone/isolated-DEV implementation-writer entry gate

Clone/isolated-DEV M1 implementation writing is **YES** only when every item is true; shared-DB and production writing still require the separate M6 single-writer cutover gate:

- [ ] M0 integrity discrepancy is reconciled and migration policy approved.
- [ ] M0 migration and physical postconditions pass on an authorized fresh disposable clone.
- [ ] Pricing fixture/parity and `Pricing.calculate` contracts are approved.
- [ ] Calculated-price versus SellingPriceDecision and historical evidence are approved.
- [ ] Sales/Billing current-state, Quote checkpoint, Draft/Issued Invoice, and one-Draft invariant contracts are approved.
- [ ] Product/CRM scoped compatibility readers are defined and tested.
- [ ] Permission compatibility, expiration/retirement, and no-global-admin policy are approved; broad writer uses set persistence.
- [ ] Minimal Routing work-item/template/instance decision is approved.
- [ ] M1 additive migration list and physical postconditions are approved.
- [ ] Clone concurrency/failure/idempotency/tenant test plan is ready.
- [ ] Legacy workers/webhooks/consumers/provider side effects are inventoried and suppressed in the writer environment.
- [ ] V1/V2 single-writer cutover inventory and no-dual-write control are approved for the later M6 gate.

Until then the answer is **NO**. Contract/read-only work may proceed only within the earlier prompt boundaries.

## 14. Recommended first implementation prompt

"Close the V2 M0 physical-readiness gate. Investigate and reconcile the protected migration-history integrity failure without rewriting history blindly; define the approved manifest policy; then, only with an explicitly authorized disposable DEV-shaped clone, rehearse the immutable M0 migration stream and execute real catalog postcondition plus persistence/idempotency/outbox tests. Do not implement commercial modules, modify V1 runtime, deploy, or use a production database."
