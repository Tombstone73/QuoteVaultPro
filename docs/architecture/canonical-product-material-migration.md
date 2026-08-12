# Shared canonical Product material migration

> Generated from `server/services/products/canonicalProductMaterialOperations.ts`. This is one completed slice of original migration item 9.

| Material concept | Canonical ownership | Product Editor | AI / ProductIntent | Status |
|---|---|---|---|---|
| Product primary material | `products.update_material_configuration.v1` | Existing Product PATCH delegates assign/change/clear | Existing Product GO and new-draft canonical material proposal use the same tenant/active validation | `shared_canonical` |
| Tenant material resolution | Server-owned exact matching over active tenant Materials; ambiguity remains unresolved | IDs are revalidated, not trusted from transport | Natural-language labels become trusted references only after server resolution | `shared_canonical` |
| Allowed Product links | Material editor / `material_product_links` | Separate surface | Not broadened | `deferred_existing` |
| PBV2 overrides/effects and production consumption | Existing PBV2, prepress, inventory, and production services | Unchanged | Not broadened | `downstream_unchanged` |

Inactive materials remain valid historical references but cannot be newly assigned. Deleted primary references retain the database's existing `ON DELETE SET NULL` behavior. Historical V1 Product drafts import material state through one compatibility adapter on their next write.
