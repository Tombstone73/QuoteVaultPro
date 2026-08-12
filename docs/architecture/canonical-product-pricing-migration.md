# Shared canonical Product pricing migration

> Generated from `server/services/products/canonicalProductPricingOperations.ts`. This is one completed slice of original migration item 9.

| Pricing family | Canonical operation | UI usage | AI usage | Persistence / audit | Status |
|---|---|---|---|---|---|
| Product pricing metadata and PBV2 scalar base/basis | `products.update_pricing.v1` | Product Editor PATCH plus PBV2 DRAFT save | `products.adjust_pricing` for persisted scalar changes; canonical Product-intent proposal for basis | Existing PBV2 version replacement and pricing change sets | `shared_canonical` |
| Complete PBV2 pricing matrix | `products.replace_pricing_matrix.v1` | Product Editor PBV2 DRAFT save | `products.replace_inactive_matrix` compatibility command | Exact inactive DRAFT transaction/idempotency | `shared_canonical` |
| Complete PBV2 tier family | `products.replace_quantity_tiers.v1` | Product Editor PBV2 DRAFT save | `products.replace_inactive_quantity_tiers` compatibility command | Exact inactive DRAFT transaction/idempotency | `shared_canonical` |
| PBV2 percentage option impact | `products.update_option_percentage_impact.v1` | Product Editor PBV2 DRAFT save | Canonical new-Product intent proposal; no broadened persisted-Product command | Existing PBV2 DRAFT persistence; quote evaluation unchanged | `shared_canonical` |
| Persisted scalar pricing change set / rollback | compatibility IDs delegate to `products.update_pricing.v1` | No separate UI snapshot surface | `products.adjust_pricing`; `products.rollback_pricing_change_set` | Existing atomic snapshot/change-set records retained | `compatibility_only` identifier, shared handler |
| Customer-specific pricing | deferred | Existing customer paths | Not broadened | Separate existing ownership | `ui_only_not_migrated` |

## Pricing ownership

Pricing configuration and explicit missing-information state are validated here and persisted through Product/PBV2 operations. Quote and order pricing continue to be evaluated by the existing PBV2 pricing engine. No calculation formulas, rounding rules, matrix lookup, tier selection, minimum-charge behavior, percentage stacking order, or customer override behavior are reimplemented here.

## Lifecycle and rollback

Matrix and tier compatibility commands remain exact inactive-DRAFT operations. Scalar ACTIVE changes continue to create immutable replacement ACTIVE tree versions. Existing persisted pricing change sets, stale fingerprints, confirmation/GO, idempotency, audit attribution, and compensating rollback remain authoritative; this migration creates no second snapshot system.
