# ProductIntentCompiler responsibility migration

> Generated from `server/services/productIntentCompiler/productIntentCanonicalProposal.ts`. Item 8 is architecturally complete: the semantic layer interprets and plans; it is not capability or execution authority.

## Final request path

Both first-turn `complete_intent` compatibility payloads and multi-turn semantic operations now cross the same pre-persistence boundary:

`natural language -> canonical Product/PBV2 proposal state -> resolver/canonical validation -> V1 compatibility projection -> final creation projection`

The persisted `canonicalProposalState` is authoritative for migrated Product configuration and PBV2 shape. `ProductDraftIntent` remains the revision envelope and compatibility carrier required by the current resolver and final inactive-Product creation workflow.

## Responsibility ownership

| Owner | Final responsibility |
|---|---|
| ProductIntentCompiler / semantic planner | Natural-language interpretation, ambiguity, direct evidence, missing information, unsupported-detail preservation and proposal construction |
| Canonical Product configuration | `products.update_configuration.v1` input shape for name, description, category/type, measurement mode, workflow intent, proof and production-job normalization/validation |
| Canonical PBV2 option configuration | `products.update_option_configuration.v1` input shape for groups, inputs, choices, required/default state, text/textarea inputs, ordering and supported visibility reference validation |
| Canonical Product intent session | Tenant/actor-bound revisions, continuity, CAS fingerprints, stale-state protection and resolver presentation |
| Authority / lifecycle / execution | Capability truth, AI eligibility, GO, revalidation, idempotency, audit and final persisted execution |

## Semantic operation catalog

| Status | Operations |
|---|---|
| Retained interpretation operations | set_product_name, set_product_description, set_category, set_measurement_mode, set_proof_requirement, add/rename option group, add option value/text input, set default, set availability, pricing basis/scalar/matrix/percentage impact, record unsupported detail |
| Canonical proposal-backed | Product identity/configuration, PBV2 groups/inputs/choices/defaults/ordering/simple visibility, and Product pricing configuration/percentage impacts |
| Compatibility only | set_material, remove option value/group |
| Removed obsolete behavior | Migrated-field branches in the compatibility translator, grommet phrase repair, implicit Yes/No choices, grommet-placement cleanup and provider operation-order requirements |

## ProductDraftIntent classification

- **Canonical proposal-backed compatibility projection:** identity/configuration, workflow, measurement, PBV2 option groups/inputs/choices/defaults/visibility, and pricing. These are regenerated from `canonicalProposalState` on new writes.
- **Material compatibility:** material interpretation and tenant reference resolution.
- **Lifecycle compatibility:** inactive/unpublished draft state, creation transport and final Product/PBV2 projection.
- **Historical compatibility:** V1 JSONB rows without `canonicalProposalState` load unchanged and are imported through one explicit V1 adapter on their next write.
- **Removed as capability truth:** independently mutable migrated Product/PBV2 fields and their dormant compatibility-translator handlers.

## Unsupported and missing information

Unsupported detail is stored in canonical proposal state. Customer-specific availability remains non-blocking, while counted grommet detail remains an explicit unresolved question because the underlying model cannot encode it. Required missing information, ambiguity, unresolved tenant references and partial multi-turn drafting remain semantic/resolver responsibilities.

## Remaining Product-domain migration work

Materials, lifecycle operations, deletion, clone/batch behavior and customer-specific configuration remain outside this closeout. Pricing is now shared canonical under item 9.
