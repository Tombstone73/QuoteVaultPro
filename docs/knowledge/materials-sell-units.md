---
slug: materials-sell-units
title: Materials versus product sell units
category: materials
version: 2026-07-23
status: active
audience: staff
summary: Customer sell units differ from operational material inputs.
route_patterns: [/materials, /products]
entity_types: [product]
feature_tags: [materials]
---
# Materials versus product sell units

Materials are operational inputs and inventory units. Product sell units are the customer-facing items and quantities sold on quotes and orders.

## Product references

A Product's primary Material is one nullable tenant Material reference. It is a default used by Product displays and as an established fallback in PBV2 weight/material resolution. Product Editor and Operator assignments use active Materials from the same tenant. An inactive Material may remain on a historical Product, but it cannot be newly assigned; staff can replace or clear it. Deleting a Material clears this relational primary reference.

The Material editor's linked Products are a separate many-to-many association. Links support Material-to-Product discovery and suggestion behavior and do not set a Product's primary Material. Likewise, PBV2 choice overrides, planned inventory consumption, and material pricing effects are separate versioned configuration. A primary-Material change does not implicitly update any of them.

## Trusted resolution

Natural-language material requests are search hints, not trusted IDs. The server searches active Materials inside the current tenant. A unique exact label can resolve without unnecessary confirmation. Missing or ambiguous requests stay unresolved until the user selects a trusted candidate or explicitly leaves the Product without a primary Material. The model cannot manufacture Material, inventory, vendor, or tenant identity.

## Drafting and persisted edits

A new Product draft can carry canonical Material proposal state before a Product ID exists. Final creation revalidates the active tenant Material in the same transaction that creates the inactive Product and PBV2 DRAFT. An existing Product material change is stale-state protected and requires the normal authority, preview, and GO controls when performed by the Operator.

Material cost, stock, purchasing, reservation, prepress, and production-consumption rules remain owned by their existing services. Product sell pricing remains owned by Product/PBV2 pricing and must not be inferred from Material inventory cost.
