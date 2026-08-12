# Shared canonical Product operation migration

> Generated from `server/services/products/canonicalProductConfigurationOperations.ts`. This report describes a bounded Phase 5 migration; it does not expose generic Product execution.

| Operation | Shared users | Supported fields | Related ownership | AI protection |
|---|---|---|---|---|
| `products.update_configuration.v1` | Product Editor `PATCH /api/products/:id`; confirmed `products.update_existing_product` command | Name, description, category, product type, measurement mode, workflow intent, proof requirement, production-job requirement | PBV2 option configuration is now owned by `products.update_option_configuration.v1`; pricing, publish/activate, clone/delete, batch and customer-specific configuration remain deferred | Trusted entity, admin capability ceiling, plan, GO, authority/state revalidation |
