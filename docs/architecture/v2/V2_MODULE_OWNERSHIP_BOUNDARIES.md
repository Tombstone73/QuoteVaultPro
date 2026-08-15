# PrintersHero V2 Module Ownership and Boundary Architecture

## Status and purpose

This is the authoritative V2 ownership model. It freezes the bounded modular-monolith boundaries before M1 reconstruction. It is architecture only: not an implementation, migration, refactor, deployment, or V1 behavior change.

V2 remains one repository, one separately deployable V2 application, and one PostgreSQL core. Its modules are explicit ownership boundaries, not microservices. This decision complements the [reconstruction master plan](../V2_RECONSTRUCTION_MASTER_PLAN.md), [reuse/rewrite inventory](../V2_REUSE_REWRITE_INVENTORY.md), [cutover/rollback plan](../V2_CUTOVER_ROLLBACK_PLAN.md), and [M0 foundation](M0_FOUNDATION.md); it does not modify their decisions.

## Governing rules

### One business fact, one owner

Each mutable business fact has one authoritative owner. Other modules may hold an identity reference, request behavior through a named operation/contract, or consume an exposed result/event. They must not retain competing mutable truth, directly mutate a foreign persistence model, reproduce a foreign business rule, or reach through a boundary to another module's repository.

A cached projection, explicit reference, immutable checkpoint, or recomputable rendering is not competing ownership when its source and freshness semantics are explicit.

### Current state and history

V2 uses **current mutable state + concise business audit events + intentional immutable checkpoints**. A successful edit records the principal/actor, time, resource, and meaningful changed fields or groups. It does not record mouse clicks, focus, keystrokes, temporary unsaved state, or a complete document version for each save.

Checkpoints exist only at real business boundaries: quote sent/accepted/converted, invoice issued, proof approved, payment/refund recorded, and shipment handed off. Sent quotes and issued invoices retain immutable data/revision sufficient to reproduce the historical document; a PDF is normally rendered on demand, not retained as authoritative data.

### Quote and invoice document rendering

Draft quotes and invoices are rendered on demand from authoritative current data; rendering a draft does not create a durable document artifact. A sent Quote Revision and an issued Invoice preserve the immutable data/revision needed to reproduce what was sent or issued, then render a PDF on demand. Do not retain PDF binaries solely because they were rendered. Any legal, provider, customer-contract, or exact-binary retention requirement must be established explicitly before changing that rule.

### Business and platform boundaries

Business modules own business facts, rules, and lifecycles. Platform modules provide reusable cross-cutting capability and must not acquire business decisions merely because many modules use them. Add a top-level module only when an area has meaningful independent authoritative data, rules, lifecycle/state, operations, and ownership complexity; never create one merely for a technical folder or future work type.

## Complete module map

| Business modules | Platform / cross-cutting modules |
| --- | --- |
| Sales; Products; Pricing / PBV2; Customers / CRM; Inbound Orders; Artwork; Prepress; Production; Routing; Nesting; Inventory / Materials; Procurement; Fulfillment; Shipping; Billing; Communications; Reporting; Portal / Storefront; Bug Reporting | Authentication / Permissions; AI; Settings; Assets; Audit / History; UI System; Search; Integrations |

## Business modules

### Sales

- **Purpose.** Own canonical commercial documents and their lifecycle.
- **Authoritative facts/data.** Quotes, orders, line items, shared/current sales transaction data, customer/contact references, PO, due date, sales context, selected/resolved product configuration references, quantities, negotiated prices, quote revisions/sent history, conversion, editing, and Sales audit events.
- **Key future operations.** Create/edit/revise/send/accept quote; create/edit/cancel order; convert quote; request Billing draft synchronization.
- **May reference/consume.** Customers identities; Products and Pricing results; Artwork references; Billing invoice reference; Authentication, Audit, Communications.
- **Must not own.** CRM, product/pricing rules, invoices/payments, artwork truth, production/routing/fulfillment/shipping state, or provider delivery.
- **Known future capabilities.** One consistent quote/order workspace; quote alternatives and revisions; historical sent proposal viewing.
- **Important boundaries.** Conversion preserves the original Quote and its checkpoint. Sales invokes Billing through a contract; it never owns invoice persistence.
- **Open questions.** Exact quote alternative/revision UX and which current commercial facts remain shared after conversion.

### Products

- **Purpose.** Own the catalog and product identity/lifecycle.
- **Authoritative facts/data.** Product identity, active/inactive lifecycle, type/classification, attributes, PBV2 and Recipe/BOM links, product images through Assets, import/export, duplication, activation/publishing, storefront availability, and Product Type default-route relationship.
- **Key future operations.** Create/edit/duplicate/import/export/publish products; assign Product Type, pricing structure, recipe, imagery, and availability.
- **May reference/consume.** Pricing/PBV2 configuration identity; Assets; Recipe/BOM capability; Routing template reference; Settings.
- **Must not own.** Price execution, stock, production, route instances/transitions, shipping, fulfillment, billing, or Artwork.
- **Known future capabilities.** Product types expose simple facts such as printed/static/service, dimensions required, production class, and installation flag.
- **Important boundaries.** Product Type references a default route but embeds no workflow engine. A Recipe/BOM definition is conceptually Product-adjacent while Inventory owns material accounting.
- **Open questions.** Exact Recipe/BOM write ownership and versioning.

### Pricing / PBV2

- **Purpose.** Own configurable product structure needed to arrive at a price.
- **Authoritative facts/data.** Questions/options, conditions, defaults, required selections, dimensions/quantity behavior for pricing, base/tier/matrix/formula prices, option effects/overrides, resolved configuration facts, and pricing inputs/results.
- **Key future operations.** Resolve/validate configuration; calculate price; manage pricing structures and formulas; return ResolvedProductConfiguration and PricingResult.
- **May reference/consume.** Product configuration links and simple facts; Nesting calculations; defined Settings inputs.
- **Must not own.** Product lifecycle, stock/reservations, material accounting, routing, production, fulfillment, shipping, or integrations.
- **Known future capabilities.** A clean Pricing contract hides PBV2 internals; the pure V1 evaluator is a candidate only behind it.
- **Important boundaries.** PBV2 may expose resolved variables for Recipe/BOM; it must not create fake options for inventory or move work.
- **Open questions.** Disposition of current workflow tags, material usage, shipping configuration, production effects, routing-like behavior, and Product Intake metadata; this is the next audit.

### Customers / CRM

- **Purpose.** Own customer relationship truth.
- **Authoritative facts/data.** Company/customer identity, contacts, addresses, status, metadata, relationships/associations, appropriate credit inputs, and preferences.
- **Key future operations.** Create/edit/merge customer/contact; manage address, status, preference, and association.
- **May reference/consume.** Authentication scope, Assets customer logos, Settings, and Sales/Billing references.
- **Must not own.** Quotes/orders, invoices/payments, product/pricing rules, or Portal authority.
- **Known future capabilities.** Customer-specific associations, credit inputs, and portal scoping.
- **Important boundaries.** Sales references CRM truth; Billing reads needed data; a customer merge is a named cross-module operation, never direct foreign-table rewrites.
- **Open questions.** Exact credit-policy split between CRM configuration and Billing decisions.

### Inbound Orders

- **Purpose.** Own intake and review before canonical Sales creation.
- **Authoritative facts/data.** Original email/manual/document source, parsing, extracted fields, match proposals, dimensions, quantity, PO/due/shipping proposals, missing info, confidence, review/correction state, and submission identity/idempotency.
- **Key future operations.** Ingest/parse; propose matches; review/correct; submit canonical quote or order; preserve source evidence.
- **May reference/consume.** Customers/Products matching queries, Artwork intake, AI proposals, Authentication, and Sales operations.
- **Must not own.** Canonical quote/order data, price/tax rules, or an alternate order copy after submission.
- **Known future capabilities.** Multi-channel intake and assisted extraction.
- **Important boundaries.** Terminal submission calls Sales.createOrder or Sales.createQuote; Inbound retains source/history and resulting reference only.
- **Open questions.** Final confidence thresholds and which fields require human review.

### Artwork

- **Purpose.** Own first-class customer and production artwork lifecycle.
- **Authoritative facts/data.** Source/customer artwork, production artwork, versions, replacements, source-derived lineage, grouping/layers, proof-source links, production designation, readiness, production derivatives, automation output, and retirement.
- **Key future operations.** Upload/replace/retire/compose; derive/designate production file; attach proof source; report readiness.
- **May reference/consume.** Storage through contracts; Sales references; Prepress results; Production/Nesting derivative requests; Authentication, Audit, Integrations.
- **Must not own.** Route state, production execution/quantities, fulfillment, shipment, billing, or reusable branding media.
- **Known future capabilities.** Multi-layer prints, customer-to-cleaned-production lineage, proof sources, Illustrator automation outputs, and nesting derivatives.
- **Important boundaries.** Prepress and Production consume Artwork, never create alternate truth. Artwork is distinct from Assets even when both use storage.
- **Open questions.** Final artifact retention/rendition policy and persistent ownership of future nesting outputs.

### Prepress

- **Purpose.** Own simple preparation/validation work that makes Artwork ready for Production.
- **Authoritative facts/data.** Prepress validation/preparation state and result, selected production file reference, and bounded destination-preparation facts.
- **Key future operations.** Review/preflight; validate; select existing or uploaded production file; report preparation result/readiness.
- **May reference/consume.** Artwork contract, Product simple facts, Production destination data, Authentication, and Routing transition request.
- **Must not own.** Artwork identity/versions, route decisions, production job state, fulfillment, or provider handoff.
- **Known future capabilities.** Low-friction preparation, destination selection, and later automation.
- **Important boundaries.** Prepress reports a result; Routing decides the next internal step.
- **Open questions.** How much independent state remains after simplification and automation.

### Production

- **Purpose.** Own execution of manufacturing work.
- **Authoritative facts/data.** Production jobs/work, execution state, quantities, starts/completions, machine/station facts, operational state, and history.
- **Key future operations.** Create/claim/start/complete/reopen governed work; record output/waste/actual usage; report outcome/readiness.
- **May reference/consume.** Sales line references, Artwork production files, Routing route instance, Nesting result, Inventory operation, Authentication, Audit.
- **Must not own.** Artwork truth, route state, inventory stock, fulfillment, shipping, billing, or external production-system decisions.
- **Known future capabilities.** Machine/station execution and work-type expansion through shared modules.
- **Important boundaries.** Production reports facts and requests Inventory consumption; Routing—not Production—moves work to Fulfillment.
- **Open questions.** Detailed scheduling/resource model, if and when independently justified.

### Routing

- **Purpose.** Own internal PrintersHero workflow movement.
- **Authoritative facts/data.** Route templates, job route instances, current/next/optional/skipped steps, transitions, authorized manual rerouting, and internal destination.
- **Key future operations.** Define template; instantiate route; transition/skip/reroute; determine authorized next step.
- **May reference/consume.** Product Type default route and facts/results from Artwork, Prepress, Production, and Fulfillment.
- **Must not own.** Product/catalog truth, production quantities, artwork, inventory, shipping/provider transport, or integrations.
- **Known future capabilities.** Simple defaults: printed Proofing -> Prepress -> Production -> Fulfillment; static/resale -> Fulfillment; service/fee no route unless defined; add steps only on evidence.
- **Important boundaries.** Product Type changes do not mutate active jobs; a job retains its instantiated route unless explicitly rerouted.
- **Open questions.** Route-template persistence/versioning and future proofing/finishing semantics.

### Nesting

- **Purpose.** Own reusable fit and optimization calculations.
- **Authoritative facts/data.** Calculation definitions/results for sheet/roll fit, rotation, margins, gaps, bleed, waste, usable dimensions, mixed sizes, sheet usage, sticker nesting, and future instructions.
- **Key future operations.** Estimate price-related material use; calculate actual production nest; return deterministic calculation result.
- **May reference/consume.** Pricing dimensions, Inventory material characteristics, and Artwork/Production geometry inputs.
- **Must not own.** PBV2 structure/price, execution, stock/consumption, sales documents, or routing.
- **Known future capabilities.** Shared sheet/roll/sticker optimization and output instructions.
- **Important boundaries.** Pricing and Production both call Nesting; it is neither a PBV2 subfeature nor a Production subfeature.
- **Open questions.** Whether persisted nest output becomes an authoritative Production artifact.

### Inventory / Materials

- **Purpose.** Own material and stock truth.
- **Authoritative facts/data.** Material definitions, units/conversions, stock, movements, reservations, consumption, adjustments, availability, and material-usage truth.
- **Key future operations.** Define/reserve/release/receive/consume/adjust material; calculate availability; record correlated movements.
- **May reference/consume.** Recipe/BOM requirements, Pricing facts, Production actual use, Procurement receiving request, Nesting requirements.
- **Must not own.** PBV2 options/rules, customer-facing product options, vendor purchasing lifecycle, production execution, routing, fulfillment, or shipping.
- **Known future capabilities.** Material conversions and requirement-to-availability planning.
- **Important boundaries.** Recipe/BOM may calculate GROMMET-BRASS times a resolved selected count; only Inventory changes stock.
- **Open questions.** Exact Recipe/BOM ownership and reservation policy.

### Procurement

- **Purpose.** Own purchasing and replenishment.
- **Authoritative facts/data.** Vendors, purchase orders, receiving workflow, vendor costs, purchase units/cases/packs, minimums, and replenishment.
- **Key future operations.** Manage vendor; create/approve/send PO; receive; reconcile cost; propose replenishment.
- **May reference/consume.** Inventory queries, Product/Settings references, Authentication, Audit, Integrations.
- **Must not own.** Stock/movements, material definitions, Sales orders, product price, invoices/payments, or provider transport.
- **Known future capabilities.** Replenishment policy and vendor cost history.
- **Important boundaries.** Receiving invokes Inventory.receive; Procurement never writes inventory truth directly.
- **Open questions.** Supplier commitment and landed-cost model.

### Fulfillment

- **Purpose.** Own internal handoff of available completed goods.
- **Authoritative facts/data.** Pickup, partial/multi-visit pickup, availability for handoff, packing/handoff facts, and fulfillment completion.
- **Key future operations.** Determine availability; pack; record pickup/handoff; request shipment; report terminal fact.
- **May reference/consume.** Sales order context, Production outcomes, Inventory availability, Routing destination, Shipping operation, Billing reconciliation need, Authentication, Audit.
- **Must not own.** Production quantities, stock truth, shipment/package/carrier state, invoice math/payments, or route state.
- **Known future capabilities.** Partial, multi-visit, and stock-origin fulfillment.
- **Important boundaries.** Fulfillment may request Shipping and consume production/inventory facts without making them artificial authorization ceilings.
- **Open questions.** Availability policy across produced, stocked, and substitute-source goods.

### Shipping

- **Purpose.** Own shipment lifecycle.
- **Authoritative facts/data.** Shipments, packages, carrier/service selection, rates/results, labels, tracking, state, and carrier handoff.
- **Key future operations.** Rate/select service/create package and shipment/purchase or void label/record handoff/reconcile carrier status.
- **May reference/consume.** Fulfillment request, Sales destination, Customers address, Billing shipping-charge use, Integrations adapters, Authentication, Audit.
- **Must not own.** Fulfillment completion, order lifecycle, invoices/payments, stock, or carrier credentials/transport.
- **Known future capabilities.** Multi-package and provider-rate workflows.
- **Important boundaries.** Carrier communication is Integrations; Shipping exposes authoritative shipment results to consumers.
- **Open questions.** Shipping-charge timing and multi-origin shipment policy.

### Billing

- **Purpose.** Own financial documents and lifecycle.
- **Authoritative facts/data.** Invoices, lines/math/lifecycle, payments, refunds, credits/corrections, financial adjustments, payment-term application, and issued history.
- **Key future operations.** Create/synchronize draft; edit draft; issue/finalize; permitted issued edit/correction; record payment/refund; reconcile provider receipt; render document data.
- **May reference/consume.** Sales through draft-sync contract, Customers, Fulfillment/Shipping facts, Settings terms/tax inputs, Integrations providers, Authentication, Audit.
- **Must not own.** CRM, order lifecycle, fulfillment/shipping state, provider transport, Artwork, or Production.
- **Known future capabilities.** Order-created draft invoice, permission-driven issued-invoice correction, and payment workspace linked from Order.
- **Important boundaries.** Order creation may atomically coordinate draft invoice creation. Sales requests synchronization while commercially editable; Billing owns issue/history/payment truth.
- **Open questions.** Exact issue/finalization event and post-issued correction semantics.

### Communications

- **Purpose.** Own communication intent and history.
- **Authoritative facts/data.** What/why/to whom/template/context/status and business-visible history for quote, invoice, proof, shipping, reminder, and future SMS notices.
- **Key future operations.** Compose/queue/send/retry/cancel; manage templates; record delivery history.
- **May reference/consume.** Sales, Billing, Artwork/Prepress, Shipping, Customers, Settings, Authentication, Audit, Integrations.
- **Must not own.** Quote/invoice/proof/shipment lifecycle, CRM recipient truth, provider credentials, or delivery mechanics.
- **Known future capabilities.** Template and multi-channel delivery.
- **Important boundaries.** Communications determines intent/context; Integrations transports and returns a receipt. A quote delivery also creates a Sales checkpoint.
- **Open questions.** Consent, template governance, and channel preference rules.

### Reporting

- **Purpose.** Own read-heavy non-authoritative reporting.
- **Authoritative facts/data.** Reports, dashboards, KPIs, exports, analytics, and deliberately justified read models.
- **Key future operations.** Build/query/export report; refresh projection; present sales, production, inventory, cost, and aging analytics.
- **May reference/consume.** Scoped facts/events/projections from all owners, Search, Settings, UI System.
- **Must not own.** Operational facts, lifecycle rules, or another business-rule engine.
- **Known future capabilities.** Sales, job-cost, production, inventory, and aging reporting.
- **Important boundaries.** Read models need provenance/freshness design and never write back operational truth.
- **Open questions.** Which materialized views are justified and their refresh semantics.

### Portal / Storefront

- **Purpose.** Own customer-facing application behavior.
- **Authoritative facts/data.** Customer-facing storefront/workspace behavior and presentation context, not alternate domain truth.
- **Key future operations.** Present customer-scoped catalog/workspaces; submit canonical requests; approve quote/proof; upload artwork; initiate payment.
- **May reference/consume.** Customer-scoped Principals; Sales, Products/Pricing, Artwork, Billing, Shipping, Customers, UI System, Settings, Communications DTOs/operations.
- **Must not own.** Alternate Sales/Billing/Artwork/Pricing rules, internal data, identity authority, or route state.
- **Known future capabilities.** Branded storefronts, customer catalogs, ordering, proofs, artwork, status, invoices, and payments.
- **Important boundaries.** Portal calls canonical operations as a scoped Principal; UI System renders branding while Portal owns behavior.
- **Open questions.** Customer pricing/availability policy and storefront tenancy/brand model.

### Bug Reporting

- **Purpose.** Own user-submitted application defect reporting.
- **Authoritative facts/data.** Reports, page/build/user/org context, supported screenshots, severity/category, comments/status, affected-resource link, and sanitized diagnostic context.
- **Key future operations.** Submit/triage/comment/classify/link/redact/attach safe evidence/hand off externally.
- **May reference/consume.** Authentication, Settings build context, Assets safe screenshots, Audit correlation, Integrations.
- **Must not own.** Core business lifecycle/data, unrestricted tenant data, secrets, or external ticket-system truth.
- **Known future capabilities.** User reports with diagnostic correlation and external support handoff.
- **Important boundaries.** GitHub/support transport is Integrations; capture and exposure are scope/redaction governed.
- **Open questions.** Retention/redaction requirements and external issue synchronization policy.

## Platform and cross-cutting modules

### Authentication / Permissions

- **Purpose.** Own authentication identity, configurable named permission sets, assignments, scope, capability decisions, and authority policy.
- **Authoritative facts/data.** Principals/identity bindings, permission-set definitions/assignments, scopes, and authority decisions.
- **Key future operations.** Issue/verify Principal; manage permission sets/grants; evaluate identity + scope + assigned sets + hard platform ceilings; revoke/session management.
- **May reference/consume.** Customers portal scope, Settings, Audit, and every module's operation/resource-scope declaration.
- **Must not own.** Domain business rules or mutable domain data.
- **Known future capabilities.** Unlimited organization-defined named sets such as Sales, Production, Accounting, and portal variants.
- **Important boundaries.** Preserve M0 PrincipalIssuer and pure AuthorityPolicy. Delegated AI cannot exceed verified Staff; Portal/Service remain explicitly scoped; HTTP never supplies Staff claims.
- **Open questions.** Reviewed capability vocabulary, scope model, and very small hard safety ceiling set.

### AI

- **Purpose.** Own PrintersHero AI orchestration.
- **Authoritative facts/data.** Conversations/workspace context, Plan/GO, tool registry, missing-information state, proposals, model abstraction, usage/audit, delegation, and revalidation.
- **Key future operations.** Plan/propose/revalidate/invoke named operation/record usage/request model work.
- **May reference/consume.** Verified scoped Principal, authorized DTOs, canonical module operations, Audit, Settings, Integrations.
- **Must not own.** Domain lifecycle/rules, privileged mutation paths, or fabricated Staff attribution.
- **Known future capabilities.** Staff-delegated Plan/GO and controlled proposal generation.
- **Important boundaries.** AI calls Sales.createOrder, Billing.recordPayment, or Artwork.replaceArtwork like any interface; it cannot bypass authority or owners.
- **Open questions.** Durable plan retention and external model/provider split with Integrations.

### Settings

- **Purpose.** Own configuration and preferences.
- **Authoritative facts/data.** Organization/user settings for numbering, tax, terms, production/routing defaults, notifications, theme, integration, feature, and portal/storefront configuration.
- **Key future operations.** Read/update scoped setting; resolve defaults; validate configuration ownership.
- **May reference/consume.** Authentication scope, UI System interpretation, Integrations config, and defined consumers.
- **Must not own.** Business transaction state or any business lifecycle.
- **Known future capabilities.** Layered user, organization, and storefront configuration.
- **Important boundaries.** Settings stores configuration; business owners apply rules and UI System interprets presentation. It is not an untyped catch-all.
- **Open questions.** Configuration schema/versioning and tenant override precedence.

### Assets

- **Purpose.** Own reusable/shared media.
- **Authoritative facts/data.** Organization/customer logos where appropriate, product images, branding/theme graphics, reusable application media, and possibly avatars.
- **Key future operations.** Upload/manage/replace/retire reusable asset; assign reference; deliver safe rendition.
- **May reference/consume.** Products, Customers, UI System, Settings, Authentication, Integrations storage.
- **Must not own.** Customer/production artwork, artwork lineage/proofs/derivatives, or arbitrary generated files.
- **Known future capabilities.** Reusable branding and application media catalog.
- **Important boundaries.** Artwork remains a distinct owner even if Assets and Artwork share storage infrastructure.
- **Open questions.** Customer-logo ownership and retention policy.

### Audit / History

- **Purpose.** Own cross-cutting meaningful operation history.
- **Authoritative facts/data.** Successful operation event with principal, verified Staff actor/delegator, organization, operation, resource, changed groups, timestamp, and correlation.
- **Key future operations.** Record/query authorized meaningful audit event and correlate request/attribution/result.
- **May reference/consume.** Every operation result/event, Authentication attribution, M0 operation request and durable-work context.
- **Must not own.** Domain snapshots, business decisions, UI interaction logs, or database-trigger copies of every column.
- **Known future capabilities.** Cross-module resource history and attribution.
- **Important boundaries.** Business modules own their immutable checkpoints; Audit records the cross-cutting account and cannot substitute for checkpoint data.
- **Open questions.** Retention, redaction, and actor-visible history policy.

### UI System

- **Purpose.** Own reusable presentation system.
- **Authoritative facts/data.** Design tokens, semantic colors/typography/spacing/density/radius, component variants, shell/navigation, shared forms/tables/cards/dialogs/status, responsive behavior, document workspaces, and theme rendering.
- **Key future operations.** Render semantic component/theme; provide workspace primitives; resolve presentation layers.
- **May reference/consume.** Settings, Assets, Portal branding, Authentication preferences, and business DTOs.
- **Must not own.** Business rules/data, configuration persistence, storefront behavior, or domain mutations.
- **Known future capabilities.** System Default + Organization Theme + User Preferences + Customer/Storefront Branding, including controlled density/layout/type/color options.
- **Important boundaries.** Settings stores preferences; UI System interprets them. Business UI uses semantic tokens, never hard-coded visual identity.
- **Open questions.** Initial token taxonomy and allowable storefront customization range.

### Search

- **Purpose.** Own search indexing/query behavior.
- **Authoritative facts/data.** Non-authoritative indexed/read projections and search metadata.
- **Key future operations.** Index/remove projection; query/rank/filter; return authorized result DTOs.
- **May reference/consume.** Authorized owner projections/events, Authentication scope, Settings, UI System.
- **Must not own.** Source records, mutations/lifecycle rules, or grants.
- **Known future capabilities.** Global search across customers, sales, products, artwork, shipments, and production.
- **Important boundaries.** Results retain source owner/scope; Search cannot repair a source record by mutation.
- **Open questions.** Index freshness/rebuild and authorization filtering strategy.

### Integrations

- **Purpose.** Own PrintersHero-to-outside-PrintersHero capability.
- **Authoritative facts/data.** Adapter connection/configuration references, transport request/receipt, webhook/provider correlation, retry/reconciliation state, and external-system mapping.
- **Key future operations.** Send/retry/reconcile; receive/verify webhook; manage connection; hand off to QuickBooks, Stripe, carriers, email, storage, Local Bridge, Onyx, Illustrator, MCP, APIs, webhooks, and partners.
- **May reference/consume.** Named business operation/results, Settings, scoped service authority, M0 durable work, Audit.
- **Must not own.** Core business validity/decisions, internal Routing, invoice/refund authority, or domain-table writes.
- **Known future capabilities.** Durable provider adapters and external workflow handoffs.
- **Important boundaries.** Routing decides internal movement/intent; Integrations crosses the external boundary. It invokes owner operations for provider outcomes rather than writing business data.
- **Open questions.** Provider receipt/reconciliation retention and exact AI-vs-Integrations model adapter ownership.

## Cross-module transaction policy

One PostgreSQL core permits atomic cross-module operations where integrity requires them. A coordinating application operation can, for example, create Sales Order and lines, request Billing Draft Invoice and lines, record Audit, enqueue durable work, and commit together.

Atomic coordination does not change persistence ownership: the coordinator calls each module's named operation/port; it does not write foreign tables, reuse foreign repositories, or duplicate foreign rules. Operation requests use organization + operation + business request identity (never actor-scoped) for durable idempotency. External effects occur after commit from durable outbox/reconciliation work with deterministic correlation; no fire-and-forget provider calls.

## Good and forbidden interactions

**Good**

- Inbound preserves source/review, then calls Sales.createOrder with its submission identity and keeps only the returned reference.
- Sales converts a Quote without repricing or deleting it; through contracts it creates Order, Draft Invoice, Audit, and durable work atomically.
- Pricing asks Nesting for sheet requirement; Recipe/BOM derives material requirement; Inventory owns reserve/consume effects.
- Production reports output and asks Inventory to consume; Routing evaluates the result and authorizes the next step.
- Communications determines an issued-invoice notice; Integrations delivers it and returns a receipt.

**Forbidden**

- PBV2 directly reserves stock, creates shipment, or changes route because V1 metadata currently blends those concerns.
- A Sales route updates invoice/payment persistence or maintains a second mutable invoice copy.
- Production independently marks Fulfillment or route progress complete.
- Portal implements second Pricing, Proof, Billing, or authority rules.
- A Stripe/carrier/Onyx adapter directly writes business records or decides a refund/shipment validity.
- Reporting/Search mutates operational truth; Audit becomes blanket record versioning.

## V1 anti-corruption and reuse

V1 is behavior evidence, not V2 ownership. Every reuse is classified **reuse as-is**, **reuse behind V2 contract**, **reconstruct**, or **remove**. Potential contract-bound reuse includes the pure PBV2 evaluator, calculation utilities, stable value types, selected validators/UI components/integration infrastructure, and V1/POC characterization contracts. It does not authorize reuse of route-local logic, broad repositories, giant orchestration services, scattered authorization checks, mixed routing/production logic, duplicated Sales/Billing state, V1 mutation routes, or the v2-poc runtime.

M0 already prohibits production v2 imports from V1 routes/services/index/workers and v2-poc; it prohibits interfaces importing repositories/raw DB and keeps policy pure. M1+ must extend boundary tests without weakening M0 to accommodate V1 coupling. Compatibility repositories contain legacy schema representations only.

## Repository reality check

Read-only inspection identifies focused reconstruction inputs, not work to fix now.

- **PBV2 mixes non-pricing concerns.** shared/pbv2/validator/validatePublish.ts validates tree.meta.shippingConfig; shared/pbv2/rollMediaLayout.ts performs production/nesting-oriented layout; and server/lib/duplicateProductTransform.ts duplicates workflow intent, primary-material, nesting, and production-job flags.
- **Artwork truth is distributed.** server/services/artwork/LineItemArtworkReadResolver.ts resolves across legacy attachments, assets, and workflow files; server/routes/orderLineItemFiles.routes.ts directly updates assets, attachments, and line-item files; server/routes/prepressFiles.routes.ts retires line-item files.
- **Routing is outside a Routing owner.** server/services/productionRoutingService.ts, server/services/productionRoutingResolver.ts, server/routes/prepress.routes.ts, and server/routes/orders.routes.ts each embody internal workflow decisions.
- **Orders are a cross-domain mutation hub.** server/routes/orders.routes.ts imports fulfillment, Billing, workflow/routing, proofing, Artwork, PBV2 material effects, reservations, storage, and material adjustment concerns.
- **Sales/Billing and common state are coupled/duplicated.** server/services/orders/canonicalOrderOperations.ts and server/invoicesService.ts synchronize drafts from orders; shared/schema.ts holds overlapping quote/order/invoice customer, totals, shipping, payment, and status fields. Some fields are valid historical snapshots, so V2 must distinguish them from current mutable copies.
- **Authority is scattered.** Role conditionals appear in server/routes/quotes.routes.ts, server/routes/orders.routes.ts, server/services/productionRunService.ts, and production/quote UI components, while Assistant authority lives under server/services/assistant/.
- **Integrations can mutate business tables.** server/quickbooksService.ts and server/services/quickbooksSyncQueueWorker.ts update Customers, Orders, Invoices, and Payments directly.
- **Fulfillment and Shipping are co-located.** server/routes/fulfillment.routes.ts groups pickup with shipment/package/mark-shipped operations.

These are important ownership conflicts, not a file-by-file criticism. Existing V1 hardening remains behavior evidence for the future contracts.

## Relationship to M0 and implications for M1+

M0 is unchanged: it is a separately buildable/deployable V2 shell with no commercial mutation route and V1 as sole writer. It establishes trusted Principal issuance, pure AuthorityPolicy, organization-scoped repositories, operation-specific idempotency/attribution, durable work, additive migrations with physical postconditions, and boundary tests.

M1+ introduces vertical slices through this owner map, not a general V1 adapter. M1 should establish the commercial spine through Customers/CRM, Products, Pricing behind its contract, Sales, and Billing draft-invoice coordination. It must retain V1 as sole writer until a domain gate passes, use read-only shadow/parity only, avoid dual writes, use compatibility repositories, and record external work transactionally after commit. No startup DDL or copied POC DDL is permitted.

## Open questions and required next audit

The module-level questions above are intentionally unresolved. Program-level questions include legal/provider needs for exact PDF-binary retention, Search and Reporting projection freshness, and whether Installation later earns module status through independent crews, appointments, sites, equipment, travel, photos, signoff, and scheduling. Until then, installation is a Product/Route fact, and apparel/fabrication/decorating/graphics/engraving work types use the existing shared modules.

The required next task is **PBV2 / Pricing Ownership Audit**, followed by **Authentication / Permissions Audit**, then **Routing Ownership Audit**. These are architecture/reconstruction audits only; none authorizes a production migration, business rewrite, or extraction.
