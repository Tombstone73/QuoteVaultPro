# Shared canonical PBV2 option migration

> Generated from `server/services/products/canonicalPbv2OptionConfigurationOperations.ts`. Pricing is delegated to the shared Product pricing boundary; Product lifecycle mutations are excluded.

| Operation | Shared users | Supported PBV2 representation | Compatibility | Deferred |
|---|---|---|---|---|
| `products.update_option_configuration.v1` | Product Editor DRAFT save; confirmed `products.update_existing_product` command | GROUP/INPUT labels and descriptions, required state, input type, choice metadata/order, defaults, node/group/choice visibility rules | Legacy `set_option_default` is accepted and translated to this operation | Publish/activate, deletion, customer-specific configuration |

## Parity classification

| Product area | Classification | Evidence |
|---|---|---|
| Group/input/choice metadata, required/default, text inputs, simple visibility | `shared_canonical` | Product Editor DRAFT save and confirmed Operator use the shared operation |
| `set_option_default` identifier | `compatibility_only` | Accepted for persisted plans; translated to the canonical PBV2 mutation |
| Option deletion and complex nested visibility authoring | `ui_only_not_migrated` | Existing editor/model paths remain; not model-facing in this operation |
| ProductIntentCompiler semantic PBV2 construction | `shared_canonical` | New-product proposals use the same option and pricing schemas before persistence |
| Dedicated first-class conditional-input entity | `unsupported_underlying_model` | PBV2 represents conditional input through generic INPUT visibility rules |
| Pricing | `shared_canonical` | DRAFT saves delegate validation to `CanonicalProductPricingOperations`; dedicated pricing commands share the same boundary |
| Product lifecycle | `ui_only_not_migrated` | Publish and activate remain outside this operation |
