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

Existing Product option configuration uses the shared canonical PBV2 DRAFT operation. Groups are structural `GROUP` nodes; customer fields are `INPUT` nodes with stable `selectionKey` values. Select choices have stable internal values and customer labels. Defaults must use existing values, and required selects need a choice.

Text and textarea fields are normal inputs. Conditional fields and group/value availability use visibility rules referencing an existing `selectionKey`; select conditions use existing choice values. Existing Product edits require a trusted Product, preview, GO, and fresh DRAFT version. Pricing, publish/activate, deletion, customer-specific behavior, and complex nested visibility authoring remain outside this capability. Never guess an unresolved group, input, choice, or condition.

## Existing Product configuration

Existing Product identity and operational configuration use the shared canonical Product operation for name, description, category, product type, measurement mode, workflow intent, proof requirement, and production-job requirement. These edits are separate from new Product drafting and require a trusted existing Product reference. Assistant proposals for this operation require GO; server validation and current Product state win over skill guidance.

The shared operation does not replace PBV2 pricing matrix changes, quantity tiers, option-tree editing, publishing, activation, cloning, deletion, or customer-specific availability. Product Editor supports those through their existing paths until a later canonical migration. A service-fee workflow is quantity-only and does not require proof approval or a production job.
