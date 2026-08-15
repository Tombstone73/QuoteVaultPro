# M1.1 Commercial Contracts and Characterization

## Purpose and boundary

M1.1 defines the typed V2 commercial language; it creates no Sales, Billing, Routing, Product, or CRM persistence writer and adds no migration. It applies the approved ownership model: Sales owns Quote/Order current commercial state, Pricing owns calculated price, Sales owns the selling decision, and Billing owns Invoice lifecycle and math.

Current mutable state remains authoritative. Normal edits emit concise semantic audit changes. Immutable checkpoints are reserved for quote sent, accepted, converted, and invoice issued; they are historical evidence, never a second mutable document.

## Contract map

| Owner | Contract | Boundary |
| --- | --- | --- |
| Shared | branded IDs, ISO currency, integer-cent `Money`, basis points, serializable values | Floating-point values are never monetary truth. Decimal text is evidence for rates/measurements only. |
| Products | `SellableProductConfiguration`, `ProductsReadPort` | Product lifecycle/type/pricing configuration reference; no price evaluation. |
| Pricing | `ResolvedProductConfiguration`, `PricingCalculationRequest`, `PricingResult`, `PricingPort` | No PBV2 tree/editor state, Sales override, tax, inventory, routing, or provider behavior. |
| Sales | shared line/state/commands, `SellingPriceDecision`, checkpoints, audit changes | Customer/contact are CRM references; current Sales facts are not Invoice truth. |
| Billing | `CreateDraftInvoiceInput`, `DraftInvoiceSynchronizationInput`, `BillingPort` | Sales passes a projection; Billing owns rows, math, status, issuance, and financial checkpoints. |
| Routing | `CreateRouteForWorkItemInput`, `RoutingPort` | Later Order coordination supplies only order/line/product-type/template-revision identity. |

## Sales and line model

`SalesDocumentCurrentState` is shared by Quote and Order: organization; CRM customer/contact reference (contact-only is allowed); PO; requested due date; currency; Sales terms/context; notes; and commercial lines. A line carries a Product ID, display description, quantity, normalized resolved configuration, immutable PricingResult evidence, a separate SellingPriceDecision, and calculated/selling totals.

Quote adds expiration, send/accept state, checkpoints, and conversion linkage. Order adds source Quote/checkpoint reference, commercial cancellation state, and a linked Draft Invoice reference. Operational routing, production, fulfillment, shipping, artwork, and invoice state do not enter a Sales lifecycle enum.

## Pricing and selling price

`ResolvedProductConfiguration` is versioned and serializable: Product/configuration identity and hash, dimensions, quantity, normalized selections, price-relevant derived facts, and simple product facts. It intentionally excludes PBV2 tree JSON, editor state, intake metadata, stock, routing, and integrations.

`PricingResult` is deterministic calculated-price evidence: integer-cent unit/line amounts, components/option impacts/minimum behavior, tier/matrix/formula/nesting evidence, evaluator identity/version, rounding policy/stages, normalized inputs, and structured warnings. Formula evidence preserves the resolved expression/configuration, not only a mutable formula ID. Pricing never receives a negotiated Sales override.

`SellingPriceDecision` retains the source calculated amounts/result identity and records the distinct resulting unit/line price, optional discount, lock/override reason, authority reference, and time. It cannot overwrite PricingResult.

Tax is outside Pricing. Sales provides the declared tax context to Billing; Billing later applies and preserves tax calculation/version evidence. A current V1 tax calculation may be a temporary compatibility adapter in later milestones, not a Pricing/PBV2 responsibility.

## Checkpoints and rendering

Sales owns a discriminated `QuoteCheckpoint` only (`quote_sent`, `quote_accepted`, `quote_converted`) with a Quote-branded checkpoint ID, canonical-evidence fingerprint, occurred/principal metadata, minimum separately named customer/contact presentation identity, recipient-relevant commercial header, lines, and optional Quote checkpoint lineage. Billing owns `IssuedInvoiceCheckpoint`, including tax calculation/version/context/components. Checkpoint payloads are canonical JSON-cloned then recursively frozen; they do not capture full CRM/Product/PBV2 records or PDFs. Draft rendering remains on-demand; sent Quote and issued Invoice data can reproduce historical rendering without a binary by default.

Quote conversion consumes an explicit source Quote checkpoint. Future implementation must preserve that Quote, create a conversion checkpoint where needed, create one Order and one Draft Invoice atomically, preserve PricingResult/SellingPriceDecision, and not silently reprice. Its M0 business request is principal-neutral and exactly-once.

## Billing draft and issued boundary

Future Order creation calls `Billing.createDraftInvoice`; later commercial Order edits call `Billing.synchronizeDraftInvoice`. Both receive an immutable-at-call-time tenant-scoped Sales projection and return Billing-owned Invoice identity/status. Sales never writes invoice rows or performs Invoice math.

There will be exactly one current non-void Draft Invoice per Order, enforced by a later persistence invariant. When Billing issues an Invoice it creates an issued financial/document checkpoint and silent Order synchronization becomes false. Explicit capability-governed correction is a later Billing operation; it must not mutate the original issued evidence. “Sent/delivered” remains Communications history, not financial issuance.

## Audit, authority, and compatibility reads

Normal Sales edits use `MeaningfulAuditChange`: semantic groups (`customer`, `commercial_terms`, `line`, `price`, `notes`) with stable kinds and a user-facing summary. No DB-column diffs, keystrokes, or full snapshots are audit events.

Commercial failures use the existing M0 application taxonomy: validation, not found, forbidden, wrong tenant/scope, conflict, stale state, idempotency conflict, retryable failure, and internal error. M1.1 adds no competing Sales/Billing error hierarchy.

Representative future capabilities are `quote.view/create/edit/send/convert`, `order.view/create/edit/cancel`, and `invoice.view/editDraft/issue`. The pre-M1 M0 placeholders `orders.create` and `quotes.convert` remain compatibility seeds; new commercial operations use the singular module-owned vocabulary and the aliases must be retired before a writer is exposed. AuthorityPolicy remains the M0 policy boundary; M1.1 adds no permission persistence.

`CustomersReadPort` and `ProductsReadPort` are read-only and organization-scoped. They validate CRM identity/contact association and sellable Product/Product-Type/active Pricing configuration without importing V1 routes, services, or repositories.

## Characterization and parity catalog

M1.2 fixture definitions cover 13oz Banner, 4mm Coroplast, Contour Cut Stickers, quantity-only/per-piece, matrix, formula, and cross-cutting edge cases. The catalog now includes tenant-independent Coroplast 24x18 quantity vectors (8/10/91/100/101), expected sheet/tier/rate/cent results, and V1 source provenance. Banner, Stickers, quantity-only, matrix, formula, Quote, Order, and Draft-Invoice vectors are deliberately marked **pending extraction** from their cited V1 characterization suites. M1.2 may not claim pricing parity until each has normalized inputs, expected evidence/output, and source-case provenance. Required coverage includes fixed/custom dimensions, sqft/piece/quantity price paths, minimums, quantity/sqft boundaries, matrix and formula resolution, option/percentage/multiplier effects, computed-sheet/rotation evidence, half-cent rounding stages, manual unit/total overrides, same-key replay, and cross-tenant rejection.

Every later mismatch is classified as exactly one of: `required_parity`, `intentional_v2_correction`, `v1_legacy_behavior_not_carried`, or `human_product_decision_required`. Unclassified drift is not acceptable.

V1 evidence is characterization only: `PricingService.goldenRegression`, matrix/formula/option/snapshot suites, `quoteConversionAtomicity.contract`, `quoteRoutingAndConversion.contract`, and `orderInvoiceFinancialIntegrity.contract`. Reuse candidates are pure evaluator/helpers behind Pricing; `PricingService.priceLineItem`, broad quote/order repositories, and route-local Billing orchestration are reconstructed rather than imported.

## Open decisions and next milestone

M1.6 realizes the approved additive physical foundation in [M1 Commercial Persistence](M1_COMMERCIAL_PERSISTENCE.md). It preserves these contracts as the application boundary and does not expose a commercial writer.

- Whether an unsent Quote may convert, and exact alternatives/revision UX.
- Legal/accounting definition of issued/finalized and post-issued correction semantics.
- Exact one-Draft persistence invariant and temporary Tax compatibility adapter versioning.
- Route template/revision persistence and Product-Type association details.
- Formula-library historical version policy and Recipe/BOM/physical-weight decisions.

**Next milestone: M1.2 — Pricing Parity Adapter.** It adapts the approved pure evaluator behind `PricingPort` and executes the fixture catalog. It does not begin in M1.1.
