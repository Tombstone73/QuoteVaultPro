# V2 Ownership Audit — evidence report

> **Audited commit: `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a`**
> (worktree branch `kilo/v2-architecture-audit`, HEAD verified equal to that SHA, 289 migrations, highest tag `0293_v2_custom_role_archive`).
>
> **STATUS: NON-AUTHORITATIVE EVIDENCE.** This report creates no rules and decides no ownership.
> `docs/architecture/v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md` is the single authoritative ownership model and
> wins every conflict with this report. Nothing here is binding on any agent.
> All findings apply to `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a` and to nothing else.
>
> **Update after this report was first written.** The authoritative document has since been reconciled with the implementation and now records four approved decisions (Recipe/BOM, Shipping, Replacements/rework, Inventory coexistence), the confirmed violations as **Known boundary debt (BD-1 to BD-7)**, and the unresolved conflicts as **Business decisions required (BDR-1 to BDR-6)**. See [V2_MODULE_OWNERSHIP_BOUNDARIES.md](../v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md). The findings and evidence below are **unchanged**; §3 and §7 carry a cross-reference to the authoritative identifiers. Where this report describes the authoritative document as silent or stale (§0, §2, §7), that description is accurate for the version of the document that existed when the report was written (`04efc9fa`) and is superseded by the reconciled document for the topics it now covers.

## 0. Method and limits

- Scope: `v2/src`, `v2/infrastructure`, `v2/scripts`, `v2/tests`, `server/db/migrations_v2`, `package.json`, `.github/workflows`, and V1 code only where V2 imports it.
- Measurements were scripted (regex extraction of SQL write verbs and import specifiers) and every non-trivial hit was read in full. Reads, lock-only coordination, immutable snapshots, and projections were **not** counted as violations.
- Limits: SQL is found by pattern in TypeScript strings. Dynamically built SQL, and SQL in migrations (triggers), were not analysed. `v2/ui`, `client/`, and `server/routes/**` were not audited except where V2 imports them. Behavior was not executed; nothing was run against a database.
- **The authoritative document is stale relative to the code.** It is 394 lines, unchanged in content from the earlier `v2/reconstruction` snapshot, last changed by one commit (`04efc9fa`), and has no section for replacement obligations, shipment containers, shipping pricing, cutover, portal, inbound, AI, accounting, communications, documents, or organization/team-access. Where it is silent, findings below are class **B**, not violations.

Reproduction commands are in Appendix A.

## 1. Module ownership map (per the authoritative document, plus code that exists without a section)

Legend: **Doc** = section exists in the authoritative document. **Code** = module exists at the audited commit.

| Module | Doc | V2 code (`v2/src/modules/…`, `v2/infrastructure/…`) |
| --- | --- | --- |
| Sales (Quotes, Orders) | yes | `sales/` (quote/order/conversion/lifecycle/tax) + `infrastructure/sales/` |
| Products | yes | `products/` + `infrastructure/products/` |
| Pricing / PBV2 | yes | `pricing/` (contract, adapter, formula domain, nesting seam) + `infrastructure/pricing/` |
| Customers / CRM | yes | `customers/contracts.ts` (read port only) + `infrastructure/customers/` (**writes**) + `infrastructure/compatibility/` |
| Inbound Orders | yes | `inbound/` + `infrastructure/inbound/` |
| Artwork | yes | `artwork/` + `infrastructure/artwork/` |
| Prepress | yes | `prepress/` + `infrastructure/prepress/` |
| Production | yes | `production/` + `infrastructure/production/` |
| Routing | yes | `routing/` + `infrastructure/routing/` |
| Nesting | yes | **no module**; `pricing/pricingNestingEstimate.ts` seam only |
| Inventory / Materials | yes | `inventory/`, `materials/` + `infrastructure/inventory/` |
| Procurement | yes | none |
| Fulfillment | yes | `fulfillment/` + `infrastructure/fulfillment/` |
| Shipping | yes | **no `shipping` module**; shipment containers, carrier shipment, and shipping economics live inside `fulfillment/` |
| Billing (invoices, payments, refunds) | yes | `billing/` + `infrastructure/billing/` |
| Communications | yes | **no `src/modules` module**; `infrastructure/communications/` (email integration, invoice/proof delivery queues) |
| Reporting, Search, Bug Reporting | yes | none |
| Portal / Storefront | yes | `portal/` (3 files) + `infrastructure/portal/` (3 files, reads only) |
| Authentication / Permissions | yes | `src/authorization/`, `infrastructure/authorization/`, `infrastructure/authentication/` |
| AI | yes | `ai/` + `infrastructure/ai/` |
| Settings | yes | `organization/` (business profile, numbering, team access) + `infrastructure/organization/` |
| Assets | yes | `infrastructure/documents/postgresTenantBranding.ts`, `organizationLogoAdoption.ts` |
| Audit / History | yes | no module; `v2_audit_events` written by 15 infrastructure directories |
| UI System | yes | `v2/ui/` (not audited) |
| Integrations | yes | `infrastructure/accounting/` (QuickBooks), `infrastructure/billing/stripe*`, `infrastructure/communications/` |
| **Cutover** | **no** | `cutover/` (4 pure files) + `v2/scripts/assert*`, `prepare*` |
| **Replacement obligations** | **no** | `fulfillment/replacementObligations.ts`, `replacementShippingEconomics.ts`; `billing/replacementInvoice.ts` |
| **Documents (PDF rendering)** | **partial** ("Quote and invoice document rendering" principle only) | `infrastructure/documents/ownerPdfRenderer.ts`, plus `postgres*Documents.ts` in sales/billing/production/fulfillment |

Size context: 23 `v2/infrastructure` directories, 19 `v2/src/modules` directories, 32 HTTP route files, 57 infrastructure files containing SQL writes, 109 distinct `v2_` tables written by infrastructure, **0 SQL statements anywhere in `v2/src`**.

## 2. Domain findings

Each domain: authoritative section → what the code does → classification. "Read", "lock-only", "coordination through the owner", "snapshot", and "projection" are not violations.

### 2.1 Sales / Orders

- **Doc:** Sales owns quotes, orders, lines, conversion, sales-context; Billing synchronization is requested through a contract. **Code:** single writer directory `infrastructure/sales/` for `v2_sales_documents` (quote/order), `v2_sales_order_details`, `v2_sales_document_lines`, `v2_sales_quote_*`.
- **Cross-directory writers of Sales tables:** `infrastructure/artwork/postgresQuoteArtworkTransaction.ts:23` runs `UPDATE v2_sales_documents SET revision=revision+1 … WHERE revision=$3` (optimistic revision bump when quote artwork changes). This is a write to a Sales-owned column by Artwork. **Class B**: the document says Artwork is referenced by Sales, and is silent on who bumps a quote's revision. Recorded as an *observation* (write to foreign state), not a confirmed violation, because it is a revision counter on a document Artwork is attached to.
- **Order lifecycle is centralised:** `reconcileOrderInTransaction` (`infrastructure/sales/postgresOrderAutomaticLifecycle.ts:8`) is the Sales-owned writer of `v2_sales_order_details.commercial_state`. It also takes `FOR UPDATE` on `v2_billing_invoices` (line 11), which is **lock-only coordination**, not a Billing write. Fulfillment's replacement code calls it (`postgresReplacementObligations.ts:55`); that is **coordination through the owner**.
- **Sales writing Production:** `infrastructure/sales/postgresOrderTransaction.ts:335` executes `UPDATE v2_production_works SET ordered_quantity=$4 …` when a line quantity changes. The code comment (lines 330–333) declares the target a **projection** of the current commercial line. Recorded as an intentional projection (class B on placement), not a violation. See §2.5 and D-2 in §5.
- **Sales writing Routing:** `infrastructure/sales/postgresOrderWorkflowTransaction.ts:55,64` run `UPDATE v2_route_instances SET … current_step_id, revision=revision+1` for the operator "send to Production" and "Production not required" steps, after guard assertions on proof, artwork, and destination. Routing has its own lifecycle writer (`routing/postgresRoutingLifecycleTransaction.ts`). See V-3.
- **Sales-owned rows holding a frozen reference to other modules' rules** (`v2_sales_line_production_requirements`, `v2_order_line_material_requirements`): frozen snapshots on Sales lines. Not a violation.

### 2.2 Pricing

- **Doc:** Pricing owns configurable structure, base/tier/matrix/formula prices, and results; Products holds only links and "must not own price execution."
- **Code:** `pricing/contracts.ts`, `v2PricingAdapter.ts`, `formulaDomain.ts` (formula authoring/freeze domain), `infrastructure/pricing/postgresFormulaDomain.ts` writing `formula_revisions` (table created by V2 migration `0225`, so it is **V2-origin despite lacking a `v2_` prefix**).
- **Cross-writer:** `v2_product_version_formula_revision_bindings` is inserted by both `infrastructure/pricing/postgresFormulaDomain.ts:126` and `infrastructure/products/postgresProductVersionLifecycle.ts:1475`. This is a binding of a product version to a formula revision; who owns the binding is not stated. **Class B.**
- **Import direction:** `products` imports `pricing` in 7 places (`contracts`, `formulaDomain` ×2, `operatorPricingExplanation`, `pricingNestingEstimate`), `sales` imports `pricing` in 5 places, `pricing` imports `products/contracts.ts` once. Contract-level and consistent with the document's "Products may reference pricing configuration identity."
- **Old finding revisited (Pricing vs Products authoring):** draft pricing authoring (matrix/formula/option pricing) is still inside `infrastructure/products/postgresProductVersionLifecycle.ts` and writes `pbv2_tree_versions.tree_json`. The document gives "manage pricing structures and formulas" to Pricing but also gives Products "PBV2 … links." The PBV2 tree is one JSON document containing both. **Class C** (see §7 "D-1 PBV2 tree write path", now BDR-1 in the authoritative document; not to be confused with the §5 "D-1" formula-binding row).

### 2.3 Products

- **Doc:** Products owns identity, lifecycle, type, PBV2 and Recipe/BOM *links*, publication.
- **Code / V1-table writes:** Products writes V1 `products`, `product_types`, and `pbv2_tree_versions` (files: `postgresProductVersionLifecycle.ts`, `postgresProductRecipes.ts`, `postgresProductRouting.ts`, `postgresProductRoutingCompatibility.ts`, `postgresProductPublication.ts`). These are Products' own state whose physical home is a legacy table. **Not a violation; reported as V2→V1 writes (§6).**
- **Recipe/BOM:** `v2_product_recipes` and components are written by `infrastructure/products` only. Document open question stands. **Class C** (D-2).
- **V1 publication bridge** (`isCanonicalProductPublicationBridge`) is an explicit, single-file, whitelisted import of `server/services/products/canonicalProductPublishOperations.js` from `infrastructure/sales/authenticatedQuoteRuntime.ts`. The document's "V1 anti-corruption and reuse" section allows contract-bound reuse. Class **A**.

### 2.4 Recipe / BOM

Owned in code by Products (tables) and consumed by `materials/materialRequirementResolver.ts`, `inventory/inventoryLedger.ts`, `production/materialConsumption.ts`. The document states the question is open in two places (§Products, §Inventory). **Class C.** No new evidence changes it.

### 2.5 Production

- **Doc:** Production owns jobs/work, execution state, quantities; Sales, Artwork, Routing, Inventory are referenced. "Routing—not Production—moves work to Fulfillment."
- **Production's own writer:** `infrastructure/production/postgresProductionTransaction.ts:42` `createOrGetWork` inserts `v2_production_works`.
- **`v2_production_works` is written by four directories:**
  | Writer | Statement | Purpose (from column list / context) |
  | --- | --- | --- |
  | `production/` | `INSERT` (`createOrGetWork`) | canonical creation |
  | `prepress/postgresPrepressTransaction.ts:201, 215` | `INSERT` with `rework_cycle_id`, `predecessor_production_work_id`; also `UPDATE v2_production_rework_cycles` (206) | successor work after a prepress rework |
  | `fulfillment/postgresReplacementObligations.ts:57` | `INSERT` with `replacement_obligation_id`, `replacement_origin_production_work_id` | replacement production work |
  | `sales/postgresOrderTransaction.ts:335` | `UPDATE … SET ordered_quantity` | declared projection of the Sales line quantity (not counted as a violation) |
- **Classification:** the two **INSERT** paths (Prepress rework successor, Fulfillment replacement work) create Production-owned rows without going through Production's own function; the document lists Production's authoritative facts as "jobs/work, execution state, quantities" and lists Fulfillment/Prepress only under "may reference." **Foreign mutation (two writers); whether the document permits it is class B** because it is silent on rework and replacement. See V-2. The Sales **UPDATE** of `ordered_quantity` is a declared projection (code comment at `postgresOrderTransaction.ts:330-333`) and is **not** counted as a violation; see the note under §3.
- **Prepress↔Production writes in both directions** (measured writer set per table): `v2_prepress_units` — `INSERT` by `prepress` **and** by `production/postgresProductionTransaction.ts:96`, `UPDATE` by `prepress`; `v2_production_works` — see the table above; `v2_production_rework_cycles` — `INSERT`/`UPDATE` by `production`, `UPDATE` by `prepress` (line 206, setting `successor_production_work_id` and `state='production_created'`); `v2_route_instances` — `INSERT` by `routing/postgresRoutingRepository.ts`, `UPDATE` by `routing/postgresRoutingLifecycleTransaction.ts` (owner), and `UPDATE` by `prepress` and by `sales`. The rework-cycle table looks Production-owned with a Prepress completion update; it is not symmetric. See V-3.
- **Reads (acceptable):** `postgresProductionTransaction.ts` joins Artwork, Sales, Prepress, Routing for creation; all are listed under Production's "may reference."

### 2.6 Proofing

- Writes only `v2_proof_*` tables plus, in `postgresProofingTransaction.ts:59-66`: `INSERT`/`UPDATE customer_portal_access` (V1-schema table, created by V1 migration `0076`), `INSERT v2_portal_permission_set_assignments`, `UPDATE v2_permission_organization_state`, and `INSERT v2_proof_delivery_jobs`.
- **Reading the code:** when a proof is issued, Proofing find-or-creates the recipient's portal access row (status `PENDING_INVITE`), refreshes email/display name, grants the `customer_full_portal` permission set, and bumps `authority_revision`. Portal access and permission-set assignment are Authentication/Portal state. **Foreign mutation of Authentication/Portal-owned state.** See V-4.

### 2.7 Prepress

Own tables `v2_prepress_units` etc. See §2.5 for the writes into Production and Routing. Reads across five modules are acceptable.

### 2.8 Fulfillment (including replacement fulfillment)

- Own tables: `v2_fulfillment_handoffs`, handoff lines, snapshots, `v2_fulfillment_shipment_*`, containers.
- **Replacement obligations** (`fulfillment/replacementObligations.ts`, `v2_order_replacement_obligations` + events): Fulfillment owns the obligation record. **Document has no section** — class B for placement (the obligation touches Sales lifecycle, Production, and Billing).
- The adapter (`postgresReplacementObligations.ts`) does, in one transaction: lock `v2_billing_invoices` (38, lock-only), lock handoffs, insert the obligation, `reconcileOrderInTransaction` (Sales-owned function, 55: **coordination through the owner**), insert `v2_production_works` (57: foreign mutation, §2.5), and `createOrReadReplacementInvoice` (Billing-owned function, 12: **coordination through the owner**).

### 2.9 Shipping / shipment containers

- **Doc:** a distinct Shipping module owns shipments, packages, carriers, rates, labels, tracking; Fulfillment "must not own … shipment/package/carrier state."
- **Code:** no `shipping` module. Shipment containers (`shipmentContainer*.ts`), carrier shipment (`carrierShipment.ts`), shipping economics, and shipping pricing policy all live under `fulfillment/` and `infrastructure/fulfillment/`. **Class D** (ownership clear in the document; implementation lives in Fulfillment). Whether Fulfillment is *intended* to host it is a class B/C question (D-3).
- **Shipping charge onto the invoice:** `infrastructure/fulfillment/postgresShipmentShippingAllocation.ts` (`addCharge`, line 55) locks the destination invoice (`FOR UPDATE`), reads lines and taxability, recomputes tax via `composeSalesTax`, then `INSERT v2_billing_invoice_additional_charges`, `INSERT v2_billing_invoice_revisions`, and `UPDATE v2_billing_invoices` (totals). Billing has its own writer for the same charges table (`billing/postgresBillingDraftInvoiceTransaction.ts`). **Fulfillment computes Billing's tax and rewrites Billing's totals.** Document: Billing owns "invoice math"; Fulfillment "must not own … invoice math/payments." See V-1.

### 2.10 Replacement invoicing

`billing/replacementInvoice.ts` (suffix B–Z, proportional cents) and `infrastructure/billing/postgresReplacementInvoice.ts` (`createOrReadReplacementInvoice`) are Billing-owned and invoked by Fulfillment. Billing is the only writer of the resulting `v2_billing_invoices` row for replacements. **Coordination through the owner. Not a violation.** The invoice-suffix rule lives in Billing. Good.

### 2.11 Billing and Payments

- Own tables written only by `infrastructure/billing/` for payments, refunds, provider operations, invoice checkpoints. `v2_billing_invoices` also has writers in `fulfillment` (V-1) and reads by `accounting` (acceptable).
- `modules/billing` imports `sales/orderAutomaticLifecycle`, `customers/contracts`, `organization/businessProfile`; `sales` imports `billing/contracts`. Contract-level; acceptable.
- Stripe ingress, connect accounts, payment initiation live in `infrastructure/billing/` and import `server/lib/stripe.js` from three `v2/src/interfaces/http` route files (`financeRoutes.ts`, `portalInvoiceRoutes.ts`, `stripeSettingsRoutes.ts`). **Not covered by the boundary script's whitelist** yet the script passes: it blocks `server/services`, `server/routes`, `server/index`, and `server/quickbooksService`, but **not `server/lib`**. See gap G-5.

### 2.12 Inventory

- Own: `v2_inventory_reservations`, `v2_inventory_movements`, `v2_inventory_reconciliation_attempts`.
- **V2→V1 write:** `infrastructure/inventory/postgresInventoryLedgerTransaction.ts:35` and `:57` run `UPDATE materials SET stock_quantity = stock_quantity + $3 …` on every receipt and non-zero on-hand movement, in the same transaction as the `v2_inventory_movements` insert. Two mutable stores of on-hand stock, no reconciliation between them found (searched `stock_quantity` across `v2/`). The document gives Inventory "stock, movements, reservations, consumption." **Duplicate mutable authority** (Inventory owns both, so this is not a foreign mutation). See D-NEW-1. Old finding **re-measured, still present**; it is no longer the only V2→V1 write (§6).

### 2.13 Portal

`src/modules/portal/` (3 files) and `infrastructure/portal/` (3 files) contain **no SQL writes** (reads and order-creation orchestration through Sales). Portal *access and credential* state is written elsewhere: `infrastructure/organization/postgresTeamAccess.ts` (invites, tokens, statuses), `infrastructure/authentication/standaloneStaffAuth.ts` (accepting invites creates `users` and `auth_identities`, updates `customer_portal_access` and invite tokens), `infrastructure/communications/proofEmailDeliveryQueue.ts` (creates/revokes invite tokens, marks `invite_sent_at`), `infrastructure/proofing/postgresProofingTransaction.ts` (V-4). Four directories write `customer_portal_access` / `customer_portal_invite_tokens`. The document's Portal section says Portal "Must not own … identity authority"; Authentication owns identity. **Class B** for who owns `customer_portal_access`.

### 2.14 Accounting / Integrations / QuickBooks

- **Old V-1 re-measured.** V2 `infrastructure/accounting/quickBooksBillingQueue.ts` writes only `v2_quickbooks_*` tables plus `v2_audit_events`, and one V1-table update: `UPDATE organizations SET settings = jsonb_set(… '{preferences,quickBooks,autoSync}' …)` (line 84) — a configuration preference on the organization row. It reads Billing/Sales/Customers tables. **The V2 queue does not write invoices, payments, orders, or customers.** Old V-1 as stated is **resolved for the V2 path**.
- **New confirmed finding (V-5):** `quickBooksBillingQueue.ts:217` (`importInvoices`) calls V1 `importQBInvoicesByIds` (`server/quickbooksService.ts:3683-4011`), whose body executes `.update(payments)` (3827), `.update(invoices)` (3866), and `.insert(invoices)` (3918) against **V1 financial tables**. It is reachable from `POST …/import/invoices` (`v2/src/interfaces/http/quickBooksIntegrationRoutes.ts:38`). The boundary script whitelists `server/quickbooksService.js` for this file, so it passes. The V2-facing `syncV2*` functions (lines 1282–1578) do **not** write V1 financial tables (their only V1 writes are in `ensureQBCustomerIdForLocalCustomer`, which is a separate legacy helper).
- Document §Integrations: "Must not own … domain-table writes … invokes owner operations for provider outcomes rather than writing business data."

### 2.15 Inbound

`infrastructure/inbound/postgresInboundIntakeStore.ts` writes only `v2_inbound_*`. The document says terminal submission calls Sales. **Consistent (class A).** `modules/inbound` imports `sales/orderApplication` twice: contract-level call. Not a violation.

### 2.16 AI

`infrastructure/ai/postgresAiAssistantStore.ts` writes only `v2_ai_*`. Mutations go through commands (`*AiCommand(s).ts`). **Consistent with the document** ("AI calls Sales.createOrder … like any interface; it cannot bypass authority or owners"), not verified line by line for each command. Class A with a `REQUIRES CONFIRMATION` note that per-command routing to owner operations was not traced.

### 2.17 Cutover

`src/modules/cutover/` (4 files) are **pure gate functions** that take operator-collected evidence; scripts under `v2/scripts/assert*` and `prepare*` read a JSON manifest. No SQL. `v2/audits/M7_1_WRITER_AUTHORITY_MAP.md` states the writer-authority rule: V1 and V2 must never be simultaneous authorities. **Class B**: not in the ownership document; the rule is documented in `v2/audits/` and enforced only by operator evidence, not by code that checks who writes what.

### 2.18 Authorization

`src/authorization/` is pure and persistence-free (boundary-enforced). Writers of `v2_permission_*`: `infrastructure/authorization/` (2 files) **and** `infrastructure/organization/postgresTeamAccess.ts` (creates sets, capabilities, assignments, audit events, floor checks) **and** `infrastructure/proofing/…` (V-4). Team access is an authorization administration surface. **Class B**: the document places Authentication/Permissions as owner of permission sets; `organization/` is a "Settings" module in code.

### 2.19 Audit / History

`v2_audit_events` is written by 15 infrastructure directories. The document reserves Audit/History as a platform module and says business modules own immutable checkpoints while Audit records the cross-cutting account. It does not say whether domains write the shared table directly. **Class B.** No module owns it; there is no port.

## 3. Confirmed ownership violations

A violation requires a write (INSERT/UPDATE/DELETE) to state that another module owns per the authoritative document, not through that owner's function, **and** no explicit document permission.

**Cross-reference to the authoritative document.** These five are recorded there as *Known boundary debt*, not as exceptions: V-1 = BD-1, V-2 = BD-2, V-3 = BD-3, V-4 = BD-4, V-5 = BD-5. The document also records BD-6 (Inventory dual write, from §5 D-NEW-1 and Decision 4) and BD-7 (unit vocabulary in Products, from Decision 1), which are not among the five.

| ID | Violation | Evidence | Document basis |
| --- | --- | --- | --- |
| **V-1** | Fulfillment computes tax and rewrites Billing invoice totals for shipping charges | `infrastructure/fulfillment/postgresShipmentShippingAllocation.ts:55` (`INSERT v2_billing_invoice_additional_charges`, `INSERT v2_billing_invoice_revisions`, `UPDATE v2_billing_invoices`); Billing's own writer of the same table: `infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts` | §Billing owns "invoices, lines/math/lifecycle"; §Fulfillment "Must not own … invoice math/payments" |
| **V-2** | Two modules **create** Production-owned `v2_production_works` rows outside Production's `createOrGetWork` | `infrastructure/prepress/postgresPrepressTransaction.ts:201,215` (rework successor); `infrastructure/fulfillment/postgresReplacementObligations.ts:57` (replacement work) | §Production owns "jobs/work, execution state, quantities"; Prepress and Fulfillment only "may reference" |
| **V-3** | Routing-owned `v2_route_instances` step advances are written by Prepress and by Sales with direct SQL; Production also inserts Prepress-owned `v2_prepress_units` | `prepress/postgresPrepressTransaction.ts:214`; `sales/postgresOrderWorkflowTransaction.ts:55,64` (both `UPDATE … current_step_id, revision+1`, after guard assertions); `production/postgresProductionTransaction.ts:96` (`INSERT v2_prepress_units`) | §Routing owns "transitions … determine authorized next step"; §Prepress "Prepress reports a result; Routing decides the next internal step" |
| **V-4** | Proofing find-or-creates Portal access, grants the portal permission set, and bumps authority revision | `infrastructure/proofing/postgresProofingTransaction.ts:59-66` (`INSERT/UPDATE customer_portal_access`, `INSERT v2_portal_permission_set_assignments`, `UPDATE v2_permission_organization_state`) | §Authentication owns "permission-set … assignments"; §Portal "Must not own … identity authority" |
| **V-5** | V2 QuickBooks import operation reaches V1 importer that writes V1 `invoices` and `payments` | `infrastructure/accounting/quickBooksBillingQueue.ts:212-217` → `server/quickbooksService.ts:3683-4011`; route `quickBooksIntegrationRoutes.ts:38` | §Integrations "Must not own … domain-table writes"; §Billing owns invoices/payments |

V-2/V-3: the document does not mention rework, replacement, or step-advance-on-rework, so whether a narrow exception was intended is class B. They are reported as violations because the document's plain text lists these as owned by another module and contains no exception.

**Downgraded during verification (not a violation):** `sales/postgresOrderTransaction.ts:335` `UPDATE v2_production_works SET ordered_quantity`. The code states its own semantics at lines 330–333: the work's target *"remains a projection of the current commercial line."* It writes one column of a Production-owned row, but the source (Sales line quantity) and purpose are declared. Classified **intentional projection**, recorded as class B (whether Sales or Production should perform the propagation is unstated). It is listed under D-2 in §5, not §3.

**Withdrawn from earlier reports** (not re-reported): the claim that Products reads and writes Routing's tables (the binding table is Products'), the claim that a lock on Sales tables by Fulfillment is a violation (lock-only), and the claim that QuickBooks V2 writes Customers/Orders/Invoices/Payments directly (only the V1 import path does).

## 4. Intentional cross-module coordination that is NOT a violation

| Interaction | Class | Location |
| --- | --- | --- |
| Fulfillment calls Sales' `reconcileOrderInTransaction` | coordination through the owner | `postgresReplacementObligations.ts:55` → `sales/postgresOrderAutomaticLifecycle.ts:8` |
| Fulfillment calls Billing's `createOrReadReplacementInvoice` | coordination through the owner | `postgresReplacementObligations.ts:12` → `billing/postgresReplacementInvoice.ts:54` |
| `reconcileOrderInTransaction` locks `v2_billing_invoices` `FOR UPDATE` | lock-only | `postgresOrderAutomaticLifecycle.ts:11` |
| Replacement obligation locks invoices and handoffs (`FOR UPDATE OF h,hl`) | lock-only | `postgresReplacementObligations.ts:38,42` |
| Production creation joins Artwork, Sales, Prepress, Routing | reads | `postgresProductionTransaction.ts` |
| Prepress coverage reads five modules | reads | `postgresPrepressTransaction.ts` |
| Invoice lines copy Sales selling cents with `salesPricingEvidenceFingerprint` | immutable snapshot | Billing |
| Frozen requirement rows on Sales lines | immutable snapshot | `postgresProductionRequirements.ts`, `postgresOrderMaterialRequirements.ts` |
| Accounting reads Billing, Sales, Customers | projection source reads | `quickBooksBillingQueue.ts` |
| `v2_quickbooks_*` written only by Accounting | own state | |
| Product routing binding `v2_product_version_routing_specs` written by Products | own state (binding), not Routing's templates | `infrastructure/products/postgresProductRouting.ts` |
| Consumption fact plus inventory movement | immutable fact + mutable effect with `v2_inventory_reconciliation_attempts` | `inventoryLedger.ts` |
| Products/Customers/Inventory/Organization write legacy tables that hold their own state | module writing its own state to a legacy home (§6) | |
| Whitelisted bridges (product publication, logo storage, QuickBooks provider clients) | documented coexistence | `check-import-boundaries.mjs` |
| Domain modules import other modules' `contracts.ts` (46 edges) | contract consumption | §5 |

## 5. Duplicate mutable authority and duplication classes

| ID | Finding | Class |
| --- | --- | --- |
| **D-NEW-1** | On-hand stock: `v2_inventory_movements` (V2 fact) plus V1 `materials.stock_quantity` (mutable), both written in the same transaction (`postgresInventoryLedgerTransaction.ts:35,57`). No reconciliation found. Availability check reads the V1 counter (line 70). | **accidental duplicate mutable authority** |
| D-1 | Formula-revision binding row `v2_product_version_formula_revision_bindings` written by Pricing and by Products | **Two lifecycle events on one table, owner unstated.** *Correction after focused review:* the two writers do not perform the same action. Products (`postgresProductVersionLifecycle.ts:1474`) copies the ACTIVE version's binding into a new mutable Draft ("The ACTIVE binding is never retargeted"). The Formula domain (`postgresFormulaDomain.ts:126`) performs the historical freeze (`ON CONFLICT DO NOTHING`). This is not a competing mutable fact, so "duplicate authority" overstated it; who owns the row is still unstated and is part of BDR-1. |
| D-2 | Order-line quantity stored on Sales lines and propagated as `v2_production_works.ordered_quantity` | **intentional projection**: the code says the work target "remains a projection of the current commercial line" (`postgresOrderTransaction.ts:330-333`). Not a violation; whether Sales or Production performs the propagation is unstated (class B). |
| D-3 | Permission set state written by Authorization and by Team Access | **unresolved architectural duplication** (two writers, one domain) |
| D-4 | Shipping charge amounts on `v2_fulfillment_shipment_shipping_allocations` and on `v2_billing_invoice_additional_charges` | **intentional projection** (migration `0287` "shipment shipping invoice projection"; allocation row is Fulfillment's fact, charge row is Billing's document line). Source and freshness semantics are declared in the migration name; the writer of the Billing row is V-1. |
| D-5 | Consumption: `v2_production_material_consumptions` and `v2_inventory_movements` | **intentional immutable snapshot** with reconciliation |
| D-6 | Requirements: recipe components and PBV2 `inventoryConsumption` | **intentional provenance-tagged sources** (`MaterialRequirementSourceKind`), conditional on Recipe/BOM decision |
| D-7 | Money math duplicated in V1 `client/src` (four implementations found earlier) | **out of scope here**: `client/` not re-audited at this commit; `REQUIRES CONFIRMATION` |

## 6. V2→V1 writes (measured)

Method: SQL write verbs in `v2/infrastructure/**`, filtered to tables defined in `shared/schema.ts` whose first `CREATE TABLE` is **not** in a V2 migration; `formula_revisions` is excluded because V2 migration `0225` created it.

**17 V1-origin tables, 15 infrastructure files, about 70 statements.** In production source, none in `v2/src`. (A further set of statements in `v2/scripts/**` are rehearsal and reconciliation fixtures on disposable clones and are excluded.)

| V1 table | Writing files | Whose state (per document) | Reading |
| --- | --- | --- | --- |
| `customers`, `customer_contacts`, `customer_contact_links`, `customer_notes` | `infrastructure/customers/postgresCustomerContactAdministration.ts` | Customers/CRM (module has no write path in `src/modules`) | Customers writing its own state to legacy home |
| `products`, `product_types`, `pbv2_tree_versions` | `infrastructure/products/*` (5 files) | Products (and PBV2 tree JSON: Pricing/Products, D-1) | own state, legacy home |
| `materials` | `infrastructure/inventory/postgresInventoryLedgerTransaction.ts` | Inventory | **D-NEW-1** |
| `organizations`, `company_settings`, `org_invites`, `user_organizations` | `infrastructure/organization/*`, `accounting/quickBooksBillingQueue.ts:84` | Settings / Authentication | Settings own state; **accounting writes an `organizations.settings` preference** (observation, B) |
| `users`, `auth_identities` | `infrastructure/authentication/standaloneStaffAuth.ts` | Authentication | own state |
| `customer_portal_access`, `customer_portal_invite_tokens` | `authentication/`, `organization/`, `communications/`, `proofing/` | Portal/Authentication (unstated, B) | **4 writer directories**; proofing is V-4 |
| `email_settings` | `infrastructure/communications/postgresEmailIntegration.ts` | Integrations/Communications | marks V1 settings `migrated_to_v2` |
| **`invoices`, `payments`, `customers`, `orders` via V1 `importQBInvoicesByIds`** | reached from `accounting/quickBooksBillingQueue.ts:217` | Billing / CRM / Sales | **V-5**, not a direct V2 SQL statement (indirect through the bridge) |

**Old baseline superseded:** "`materials` is the only V2→V1 write" was true at the older snapshot and is **false at this commit**.

## 7. Genuine unresolved decisions requiring human input (class C only)

Only these remained after reconciliation **at the time of writing**. None was decided in this report.

**Status in the authoritative document (added after review).** Several of these have since been decided by the owner and recorded in `V2_MODULE_OWNERSHIP_BOUNDARIES.md`. The original text of each item below is preserved as the evidence and options considered at the time.

| This report | Status now | Authoritative reference |
| --- | --- | --- |
| D-1 PBV2 tree write path (Pricing vs Products) | **Still open** | BDR-1 (models M-A, M-B, M-C) |
| D-2 Recipe/BOM ownership | **Decided**: Products / Product Builder owns versioned Recipe/BOM authoring; Inventory consumes frozen requirements | Decision 1; residual BDR-2 (second requirement source), BD-7 (unit vocabulary) |
| D-3 Where Shipping lives | **Ownership decided**: Shipping is a distinct domain owner. Directory structure is an implementation question | Decision 2; BDR-6 |
| D-4 Portal access and lifecycle | **Still open** | BDR-3 |
| D-5 Successor/replacement/rework Production work | **Replacement ownership decided** (Fulfillment owns the obligation, Production owns replacement work). The mechanism for creating successor work is still open | Decision 3; BDR-4; BD-2 |
| D-6 Inventory dual write to V1 `materials` | **Direction decided**: V1 counter may exist only as a compatibility projection or bridge with reconciliation and a cutover path; dual mutable state is not an acceptable permanent architecture. Fix not specified | Decision 4; BD-6 |
| D-7 QuickBooks legacy importer behind the V2 seam | **Still open** as a decision; recorded as debt | BD-5 |
| (new) Audit writing shape | **Still open** | BDR-5 |
| (new) Fate of `pbv2_inventory_consumption` requirement source | **Still open** | BDR-2 |

### D-1 — Ownership of the PBV2 tree write path (Pricing vs Products)

- **Current behavior:** all pricing authoring (base, tier, matrix, formula, option pricing) is done by `infrastructure/products/postgresProductVersionLifecycle.ts` mutating one `pbv2_tree_versions.tree_json`. Formula binding rows are written by both Products and Pricing. Execution is in `modules/pricing`.
- **Documented intent:** Pricing owns "pricing structures and formulas"; Products owns "PBV2 … links"; Products "must not own price execution."
- **Options:** (A) Pricing owns tree pricing sections and Products calls its port; (B) Products owns the tree as an aggregate and Pricing consumes; (C) explicit split by tree section with a port for each.
- **Consequences:** A moves the largest file in the repo across a boundary and needs section-level ownership in a single JSON document; B contradicts the document text but matches the code; C needs a versioned tree contract.
- **Recommendation from existing design:** C; the document's language and the single-tree storage both fit a section-owner model.
- **Needed before the Ordering rebuild?** No for correctness of Orders; **yes** before extending pricing authoring further.

### D-2 — Recipe/BOM ownership *(the document itself lists this as open)*

- **Current behavior:** tables and authoring are in Products; consumers are Materials, Inventory, Production.
- **Intent:** Product-adjacent definition, Inventory owns accounting.
- **Options:** Products / Inventory / explicit split.
- **Recommendation:** Products (matches code, no migration).
- **Needed before Ordering rebuild?** Yes: order creation freezes requirements from the recipe.

### D-3 — Where Shipping lives

- **Current behavior:** shipment containers, carrier shipments, shipping pricing, and economics implemented inside `fulfillment/`; no `shipping` module.
- **Intent:** separate Shipping module; Fulfillment "must not own shipment/package/carrier state."
- **Options:** (A) create `shipping` and move the code; (B) amend the document to fold Shipping into Fulfillment; (C) keep as a sub-area with a stated port.
- **Recommendation:** decide before the Ordering rebuild if Orders will display or edit shipping charges; V-1 cannot be resolved without it.
- **Needed before Ordering rebuild?** Yes, because shipping charges land on invoices created from orders.

### D-4 — Who owns portal access and its lifecycle

- **Current behavior:** four directories write `customer_portal_access` and invite tokens; Proofing creates access rows.
- **Intent:** Portal "Must not own … identity authority"; Authentication owns permission sets; Customers owns contacts.
- **Options:** Authentication / Portal / Customers.
- **Recommendation:** Authentication (identity and access), with Proofing and Communications calling a single "ensure portal access" operation.
- **Needed before Ordering rebuild?** No.

### D-5 — Successor/replacement/rework work in Production

- **Current behavior:** three modules insert Production work for rework and replacement.
- **Intent:** silent.
- **Options:** (A) Production exposes a single successor-work operation; (B) document authorises Fulfillment and Prepress to create successor work under stated conditions.
- **Recommendation:** A (the pattern the code already uses for Billing and Sales).
- **Needed before Ordering rebuild?** Yes for `sales → v2_production_works.ordered_quantity`.

### D-6 — Inventory dual write to V1 `materials.stock_quantity`

- **Current behavior:** both stores updated in one transaction; availability reads the V1 counter.
- **Intent:** Inventory owns stock and movements as one fact set; V1 sole-writer until a gate passes; avoid dual writes.
- **Options:** (A) V2 ledger authoritative, V1 counter a projection; (B) V1 counter authoritative during coexistence, documented bridge; (C) add reconciliation.
- **Recommendation:** B, plus C so divergence is detectable.
- **Needed before Ordering rebuild?** Strongly advised.

### D-7 — Integrations: legacy importer behind the V2 seam

- **Current behavior:** V2 exposes QuickBooks import that runs the V1 importer.
- **Intent:** Integrations invoke owner operations, never write domain tables.
- **Options:** (A) route through Billing/Customers V2 operations; (B) keep as a documented one-time coexistence import with an end date; (C) disable in V2.
- **Recommendation:** decision needed on whether this is a migration-only path.
- **Needed before Ordering rebuild?** No.

**Reclassified out of class C:** Shipping-as-module (D-3 keeps the placement question only), Replacements (implemented; the document needs a section — class B), Portal, Nesting, Integrations target owner, Cutover authority rule (in `v2/audits`), V1→V2 writer gate (defined for cutover by pure gates; steady-state remains unenforced — class B).

## 8. Mechanical enforcement gaps

Measured against `v2/scripts/check-import-boundaries.mjs` (86 lines) and `v2/tests/importBoundary.test.ts` (10 lines). The script currently **passes**.

| ID | Gap | Evidence |
| --- | --- | --- |
| G-1 | No check reads SQL, so cross-module table writes (V-1…V-4) are invisible | script inspects import specifiers only |
| G-2 | No rule restricts `v2/src/modules/**` imports (46 cross-module edges, all currently to `contracts` or application files) | script; `imports.json` |
| G-3 | Nothing polices infrastructure-to-infrastructure imports across directories (e.g. `fulfillment → sales`, `fulfillment → billing`) | `postgresReplacementObligations.ts:12-13` |
| G-4 | `src/interfaces/**` imports `infrastructure/*` files directly (23 import statements across 16 files, none under `/infrastructure/persistence`); only `/infrastructure/persistence` is blocked, so all 23 pass | measured |
| G-5 | `server/lib/**` is not blocked: three route files import `server/lib/stripe.js` | `financeRoutes.ts`, `portalInvoiceRoutes.ts`, `stripeSettingsRoutes.ts` |
| G-6 | Four single-file V1 bridges are whitelisted by filename; the script checks the import, not what the imported V1 functions do (V-5) | `isQuickBooksBillingProviderBridge` |
| G-7 | Behavioral negative tests: **0**. `importBoundary.test.ts` asserts exit code 0. `staffAuthorityCompatibility.test.ts` asserts the script's source *contains* a rule string but never executes it on bad input | measured |
| G-8 | `src/modules/**` raw-DB and `infrastructure/` imports: none today (measured), but no rule prevents them. The script's application rule covers `src/application/` (which exists and holds `operation.ts`) and `src/domain/` (which does not exist), and even that rule omits the raw-package check | script; directory listing |
| G-9 | 173 of 249 V2 test files are referenced by no `package.json` script; 70 `*.pure.ts` files are run by nothing (all 11 replacement/shipment/shipping pure tests); no CI workflow runs `npm test`, `v2:check`, `v2:boundaries`, or any rehearsal | `package.json`, `.github/workflows` |
| G-10 | Table ownership is not declared anywhere machine-readable; the document is prose | none |

Existing assets that already enforce related invariants (reusable): `*PhysicalPostconditions.ts` per domain, `v2/tests/persistence/*Migration.contract.test.ts`, `cutoverWriterAssertion.pure.ts`, `writeFreeRuntimeGate.pure.ts`, `reconciliationControls.pure.ts`, `cloneSafety.ts`.

## 9. Recommended enforcement rules — proposal only, nothing implemented

Reads, lock-only coordination, and calls to the owner's exported function are permitted by every rule below.

1. **W1 (table-writer map).** Derive a machine-readable `table → owning module` map **from the authoritative document's ownership statements** (not from today's writers), then fail on any write from a second module except the shared platform tables (`v2_audit_events`, `v2_operation_requests`, `v2_outbox_messages`, `v2_principal_attributions`). Today this fails on 15 tables. The known violations must be carried in a separate **baseline of known boundary debt** (BD-1 to BD-7, each with an owner and a retirement condition), not as ownership exceptions: the baseline lets the check pass while guaranteeing that any *new* cross-write fails and that removing an item shrinks the baseline. A baseline entry must never be read as permission; the authoritative document states that recording debt creates no exception. Decisions BDR-1 to BDR-5 must be made before the map is final because it encodes them.
2. **W2 (no new V1-table writers).** Allow-list the 17 V1-origin tables and their current writing files; fail on any new file or table.
3. **W3 (lock is not write).** `FOR UPDATE [OF t]` on a foreign table is reported as a warning; a lock **and** a write to the same foreign table in one statement group is a failure.
4. **E1 (module layer purity).** `src/modules/**` must not import `pg`, `drizzle-orm`, `@neondatabase/serverless`, `infrastructure/`, or `server/`. Green today.
5. **E2.** `src/modules/**` must not import `src/interfaces/**` or `client/`. Green today.
6. **E3.** A module may import another module's `contracts.ts` (and named pure helper files) only; importing another module's `*Application.ts` is reported. Needs a dry run: current edges include `portal → sales/orderApplication`, `inbound → sales/orderApplication`.
7. **E4.** `src/modules/shared/**` must not import sibling domain modules (currently one: `shared → artwork/contracts`).
8. **E5.** Block `server/lib/**` and `server/**` generally in `v2/src`, with an explicit list for the three Stripe route imports.
9. **E6 (cross-directory infrastructure imports).** Allow `infrastructure/<a>` → `infrastructure/<b>` only for listed pairs (today: `fulfillment → sales`, `fulfillment → billing`).
10. **B1 (bridge body check).** For each whitelisted V1 bridge, record the imported symbols and assert the set is unchanged; adding a symbol requires an explicit edit.
11. **N1–N9 (negative tests).** Refactor the script to a pure `evaluate(files) → violations[]`; test against a fixture corpus (bad module importing `pg`, adapter writing another directory's table, non-`v2_` table write, lock-only allowed, lock+write rejected, module importing a sibling application file, clean fixture, and the real tree = zero violations).
12. **T1 (reachability).** A test asserting every `v2/tests/**/*.pure.ts` is referenced by a `package.json` script, or listed in an explicit exemption file.
13. **CI.** Add a workflow running `npm run v2:check`, `v2:boundaries`, and the new checks (they are read-only and database-free).

Suggested order: W2 → E1/E2 (green, zero churn) → N-tests → W1 with a known-debt baseline → T1 → E3–E6 after decisions BDR-1…BDR-5.

## 10. Recommendation for document organisation (unchanged principle)

One authoritative ownership document. The findings in §7 are for the owner to rule on; rulings belong in `V2_MODULE_OWNERSHIP_BOUNDARIES.md`, which should also gain sections for the modules that now exist without one (replacement obligations, shipment containers/shipping pricing, cutover, portal, inbound, AI, accounting, communications, documents, team access). This report, and any future audit, remain evidence.

*Status:* the document has since been updated accordingly (see the note at the top of this report). It now describes replacement coordination, shipping economics, cutover and writer authority, and the current state of portal, inbound, AI, accounting/integrations, communications, documents, and organization/team access. Enforcement rules in §9 remain proposals; W1 and the ownership map in particular should be derived from the reconciled document once BDR-1 to BDR-5 are decided, because the map encodes those decisions.

## Appendix B — Disposition of every multi-writer `v2_` table (15 of 109)

Shared platform tables are excluded (`v2_audit_events` has 15 writer directories; the other three have one).
94 of the 109 tables have exactly one writing directory.

| Table | Writer directories | Disposition |
| --- | --- | --- |
| `v2_billing_invoices` | billing, fulfillment | **V-1** (Fulfillment rewrites totals). Billing's own replacement-invoice writer is in `billing/`. |
| `v2_production_works` | production, prepress, fulfillment, sales | **V-2** (prepress and fulfillment INSERT); sales UPDATE is a declared projection |
| `v2_route_instances` | routing, prepress, sales | **V-3** (step advance written by prepress and sales) |
| `v2_prepress_units` | prepress, production | **V-3** (production INSERT at `postgresProductionTransaction.ts:96`). Not read in full; the insert's trigger condition was not traced (`REQUIRES CONFIRMATION`). |
| `v2_production_rework_cycles` | production, prepress | Production INSERT/UPDATE; Prepress UPDATE sets `successor_production_work_id`/`state`. Looks Production-owned with a Prepress completion update. **Class B**, no separate violation number; related to V-2. |
| `v2_portal_permission_set_assignments`, `v2_permission_organization_state` | authorization, organization, proofing | **V-4** (proofing) and **D-3** (organization/team access alongside authorization) |
| `v2_permission_sets`, `v2_permission_set_capabilities`, `v2_staff_permission_set_assignments`, `v2_permission_audit_events` | authorization, organization | **D-3**, class B: Team Access (`organization/postgresTeamAccess.ts`) administers permission sets alongside `authorization/` |
| `v2_portal_password_reset_tokens` | authentication, organization | Not traced in full. Both are identity/credential lifecycle paths (`standaloneStaffAuth.ts` consumes, `postgresTeamAccess.ts:40-41` revokes and issues). **Class B**, same question as D-4. |
| `v2_proof_delivery_jobs` | proofing, communications | Proofing INSERTs and requeues (`retryDelivery`); the Communications delivery worker claims and completes jobs (`proofEmailDeliveryQueue.ts`). A producer/consumer queue split with one table. **Class B**, not counted as a violation: a job queue is normally shared by producer and worker, and the document is silent on queue ownership. |
| `v2_product_version_formula_revision_bindings` | pricing, products | **§5 D-1** (binding row: two lifecycle events, owner unstated) and part of BDR-1 |
| `v2_sales_documents` | sales, artwork | Artwork's `bumpQuoteRevision` (`postgresQuoteArtworkTransaction.ts:23`) increments the quote revision for optimistic concurrency. **Class B observation**; not counted as a violation. |

## Appendix A — Reproduction (all read-only)

- Confirm target: `git rev-parse HEAD`; `Get-ChildItem server/db/migrations_v2 -Filter *.sql | Measure-Object`.
- Write extraction: regex `(INSERT INTO|UPDATE|DELETE FROM)\s+(ONLY\s+)?<ident>` over `v2/infrastructure`, `v2/src`, `v2/scripts`; discard `set|of|on|skip|nowait`.
- V1-origin test: table in `shared/schema.ts` `pgTable("name"` **and** first `CREATE TABLE` not in a `*_v2_*` migration (`formula_revisions` → `0225_v2_formula_domain_foundation.sql`).
- Imports: resolve relative specifiers in `v2/src/**/*.ts(x)`; group `src/modules/<a>` → `<b>`.
- Boundary run: `node v2/scripts/check-import-boundaries.mjs` → "V2 import boundaries passed."
- Unreferenced tests: file basename not present in any `package.json` script value; `.pure.ts` files cannot match Jest's `**/tests/**/*.test.ts`.
- V1 importer reachability: `server/quickbooksService.ts` function spans by line (`importQBInvoicesByIds` 3683–4011).

**All findings apply to `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a`.**
