# PBV2 Advanced Override (Temporary, Admin-Only)

This is a **temporary** workflow to let admins attach an “advanced” PBV2 tree to a product without refactoring the normal PBV2 accept/diff/apply lifecycle.

## What it is

- Admins can store an **override PBV2 tree JSON** for a product and toggle it on/off.
- When enabled, pricing evaluation uses the override tree version ID instead of the product’s normal active PBV2 tree version.
- The override tree is stored as a real row in `pbv2_tree_versions` with `status=ARCHIVED` so it does not interfere with standard draft/active queries.

## Data model

- The toggle/pointer lives inside `products.pricingProfileConfig` under `pbv2Override`.
- Override tree JSON is persisted as `pbv2_tree_versions.treeJson`.

## Runtime selection (evaluation)

- Evaluation selects the tree version ID via `selectPbv2TreeVersionIdForEvaluation({ activeTreeVersionId, pricingProfileConfig })`.
  - If override is **disabled**, use the product’s normal active tree.
  - If override is **enabled**, use the configured override `treeVersionId`.
  - If override is enabled but missing an ID, throw a `409`-style conflict error.

## API endpoints (admin-only)

- `GET /api/products/:productId/pbv2/override`
- `POST /api/products/:productId/pbv2/override/validate`
- `POST /api/products/:productId/pbv2/override/save`
- `POST /api/products/:productId/pbv2/override/toggle`
- `POST /api/products/:productId/pbv2/override/disable`

These endpoints are guarded by `isAuthenticated` + `tenantContext` + `isAdmin`.

## UI

- Admin-only controls live in the product editor’s PBV2 section (“Advanced PBV2 Override”).

## Notes

- This is intended as a bridge for complex products and should be removed or replaced by a first-class workflow once the core PBV2 lifecycle supports the same use cases.
