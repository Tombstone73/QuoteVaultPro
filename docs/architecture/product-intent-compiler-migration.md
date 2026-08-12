# ProductIntentCompiler responsibility migration

> Generated from `server/services/productIntentCompiler/productIntentCanonicalProposal.ts`. The semantic layer interprets and plans; it is not capability or execution authority.

## Responsibility map

| Class | Responsibility | Phase 7 disposition | Owner |
|---|---|---|---|
| A | Natural-language interpretation, terminology, ambiguity and evidence | keep in semantic layer | ProductIntentCompiler / proposal planner |
| B | Active draft, revisions, multi-turn continuity and trusted references | keep | canonical Product intent session |
| C | Missing required information and non-blocking unresolved detail | keep | resolver plus semantic proposal context |
| D | Product and option proposal construction | compose canonical structures | `products.update_configuration.v1` and `products.update_option_configuration.v1` schemas |
| E | Product field validity and service-fee invariants | move to canonical Product operation; legacy initial projection temporarily retained | canonical Product service |
| F | PBV2 references, defaults, selection keys and visibility validity | move to canonical PBV2 transformer/validator | canonical PBV2 service |
| G | Tenant, actor, stale state, persistence, lifecycle and GO | never semantic-layer owned | authority, persistence, lifecycle and execution layers |
| H | Pricing, material, deletion and legacy initial complete-intent projection | retain temporarily as compatibility | contained ProductDraftIntent adapter |
| I | Unsupported underlying-model detail | preserve explicitly without poisoning supported work | semantic unresolved context |

## Semantic operation catalog

| Status | Operations |
|---|---|
| Retained interpretation operations | set_product_name, set_product_description, set_category, set_measurement_mode, set_proof_requirement, add/rename option group, add option value/text input, set default, set availability, record unsupported detail |
| Simplified through canonical proposal fragments | Product identity/configuration plus PBV2 groups, inputs, choices, defaults and simple visibility |
| Compatibility only | set_material, pricing basis/rates/impacts/scalar price, remove option value/group, legacy set_matrix_rate |
| Removed obsolete behavior | grommet phrase repair, implicit Yes/No choices, grommet-placement cleanup, provider operation-order requirement |

## Remaining AI-specific Product logic

- Initial provider `complete_intent` normalization and legacy ProductDraftIntent projection.
- Pricing interpretation, matrix/rate compatibility, material resolution and delete safety.
- Natural-language name/category evidence, unresolved-question generation and multi-turn revision presentation.
- Final new-product projection remains compatible with the established ProductDraftIntent until later canonical pricing work.
