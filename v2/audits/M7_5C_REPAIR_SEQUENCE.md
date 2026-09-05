# M7.5C recommended repair sequence

1. **M7.5D — workflow-policy and operational Order projection foundation.** Decide/encode authorized normal, direct-production, and no-production paths; complete Order operational projection and traveler decision. Dependencies: route freeze, financial closure, permissions.
2. **M7.5E — Prepress and artwork operational completion.** Authoritative visual artifact access, production-art revision/upload, required-unit context, route handoff. Dependencies: workflow policy and artwork/storage boundary.
3. **M7.5F — Flatbed/Roll station completion.** Station-specific usable context, side/batch/machine decisions, materials and completion UX. Dependencies: M7.5D/E.
4. **M7.5G — Fulfillment launch scope.** Complete shipping/package/carrier/label/scan if needed, or prove/document pickup-only scope. Dependencies: workflow policy and document model.
5. **M7.5H — Inbound Orders V2-native intake.** Rebuild review/dedup/customer/artwork/order conversion against canonical V2 APIs. Dependencies: stable Order/artwork/customer flows and email authority.
6. **M7.5I — Portal scope and CRM activity.** Decide portal launch scope; add scoped order/quote/document DTOs and customer activity read model as approved. Dependencies: operational read models.
7. **M7.5J — navigation/dashboard/search/access convergence.** Expose only completed modules; add canonical dashboard/search/notifications where business-approved. Dependencies: stable domains.
8. **Future — V2 AI.** Tenant-scoped, permissioned, auditable, confirmation-based assistant/intake design. Dependencies: completed canonical operations; never revive V1 AI blindly.

Provider live validation, M7 cutover controls, UI convergence, and reconciliation gates remain parallel release constraints; this sequence does not authorize M8/M9.
