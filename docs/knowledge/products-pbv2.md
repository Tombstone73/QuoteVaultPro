---
slug: products-pbv2
title: Products and PBV2
category: products
version: 2026-08-12
status: active
audience: staff
summary: Versioned product options and pricing concepts.
route_patterns: [/products]
entity_types: [product]
feature_tags: [pbv2]
---
# Products and PBV2

PBV2 is PrintersHero's versioned product-option and pricing configuration. It evaluates selected options and preserves a pricing snapshot for saved line items.

## Shared option configuration

Existing option configuration uses the shared canonical PBV2 DRAFT operation. Structural `GROUP` nodes contain customer `INPUT` nodes with stable `selectionKey` values. Choices keep stable values and labels; defaults must reference a choice, and required selects need a choice. Text/textarea inputs and supported visibility rules use the same operation. Existing edits require a trusted Product, preview, GO, and a fresh DRAFT.

## Semantic drafting and persisted editing

A new Product may be described in one request or over several turns before it has an ID. First-turn details and later corrections use the same shared Product/PBV2 proposal rules for Product configuration and option structure. The Operator keeps draft continuity, missing information, trusted references, and unsupported detail. Optional detail is not a blocker; required information remains explicit. Proposals cannot grant execution: tenant, capability, lifecycle, stale-state, GO, and canonical validation still win.

## Existing Product configuration

Existing Product identity and operational configuration use the shared canonical Product operation for name, description, category, product type, measurement mode, workflow intent, proof requirement, and production-job requirement. These edits are separate from new Product drafting and require a trusted existing Product reference. Assistant proposals for this operation require GO; server validation and current Product state win over skill guidance.

## Product primary material

A Product may reference one primary material. Product Editor assignments and existing-Product Operator changes use the same tenant-scoped material operation. A new Product draft may keep a requested material label before it has a Product ID, but only the server may resolve that text to an active tenant Material. One exact active match may continue normally; missing or ambiguous matches remain an explicit decision. Existing-Product changes require preview and GO.

Inactive Materials remain historical references, but cannot be newly assigned. A Product can retain an inactive primary material during unrelated edits and can explicitly change or clear it. Deleting a Material clears the relational Product primary reference under the existing database rule.

Primary material, Product-linked Materials, and PBV2 Material references are different concepts. Primary material is the Product default and a weight/display fallback. Material links support association and suggestion behavior. PBV2 choice overrides, planned inventory consumption, and pricing material effects are selection/version-specific. Changing the primary Material does not rewrite those other relationships.

## Shared Product pricing

Product Editor saves and Operator pricing proposals use the shared canonical Product pricing boundary. It supports integer-cent scalar prices, pricing basis, complete one- and two-dimensional matrices, complete quantity-tier replacements, minimum charges, and established percentage-of-base option impacts. A service-fee workflow is quantity-only and does not require proof approval or a production job.

- A scalar price is one saved integer-cent amount with a basis such as per piece, per square foot, or flat fee.
- A matrix rate is controlled by one or two option axes. Every expected combination must appear exactly once; missing, duplicate, or unknown cells are invalid.
- A matrix row may carry its own quantity tiers and tier basis. Matching row tiers override product-level tiers through the existing PBV2 evaluator.
- Quantity and square-foot tier thresholds begin at 1 and increase strictly. Product-intent quantity ranges are gapless and end with one open-ended tier.
- A percentage impact is evaluated against the resolved base using the existing PBV2 calculation engine. Dependent total percentages retain their prerequisite and established stacking semantics.

Pricing configuration and pricing calculation are different responsibilities. The shared operation validates and persists configuration; quote and order pricing still use the existing PBV2 pricing engine, including its rounding, minimum-charge, tier selection, matrix lookup, snapshot, and customer-override behavior. Staff and the Operator must not recompute or guess a final price.

Missing required pricing information stays explicit. The Operator may keep a new draft unresolved, and the Product Editor may save an incomplete empty matrix while it is being authored. A confirmed pricing change still requires a trusted Product, current lifecycle state, preview, GO, a fresh fingerprint, and the applicable permission. Active scalar changes create a replacement ACTIVE tree version; existing pricing change-set snapshots and compensating rollback remain authoritative.

Pricing Engine rotation is a Product-level sheet-layout setting, distinct from customer-selectable PBV2 options. The Product Editor and confirmed existing-Product operation share a typed `allowRotation` mutation; it does not expose arbitrary pricing configuration JSON.

Publishing promotes one exact, tenant-scoped PBV2 DRAFT to ACTIVE, deprecates the prior active version, assigns the Product pointer, and records audit history in one canonical operation. Validation errors block publication. Warnings require explicit confirmation. Activating an inactive Product that has only a DRAFT transparently proposes publish then activation behind GO; the server revalidates both Product and DRAFT versions at execution. Product deletion, advanced PBV2 override/bypass controls, clone, batch, customer-specific configuration, and coupled pricing formula/profile changes remain outside this reviewed AI surface.
