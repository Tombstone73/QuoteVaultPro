# Final AI Operator architecture

The Operator Index selects bounded domain skills. Skills provide source-backed workflow knowledge only; they cannot create capability, authority, tenant access, or execution rights.

The canonical capability registry is the authoritative descriptive layer for reviewed read tools, commands, UI-only classifications, and hard denials. Trusted live context supplies the actor, tenant, and entity state. The shared authority resolver, AI-eligibility policy, and Admin privilege ceiling decide whether a proposed capability is available.

Mutations follow proposal → server validation → GO where required → canonical application operation → persistence and audit. UI routes and reviewed AI command adapters use the same business-operation boundaries. Historical planner and command identifiers remain only as thin compatibility adapters; they cannot become independent business engines.

Generated inventories and focused drift tests protect the registry, Operator Index, skills, authority ceiling, hard denies, and compatibility projections.

## Development rule

When adding or materially changing a PrintersHero business operation, reuse or create a canonical application operation. If AI exposure is appropriate, register the capability and update the relevant Operator skill. Do not add AI-specific business implementations.
