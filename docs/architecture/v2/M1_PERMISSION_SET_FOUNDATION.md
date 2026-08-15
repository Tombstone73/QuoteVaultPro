# M1.5 — Permission-Set Foundation

M1.5 replaces M1.4's temporary Staff-role runtime map. Normal V2 Staff and Portal issuance resolves only active, organization-scoped V2 permission-set assignments. A missing V2 assignment fails closed; `user_organizations.role`, global user flags, and `customer_portal_access.access_role` are never runtime authority.

Permission sets are organization-owned, additive capability sets. Staff receive the union of their active assigned sets. Portal receives assigned-set union intersected with either an explicit customer ceiling or the organization's explicit safe default ceiling, then `AuthorityPolicy` enforces the customer scope. There is no deny algebra, wildcard administrator, or cross-organization ID lookup.

The static capability catalog is normalized and FK-backed. Global immutable templates seed editable organization-owned set copies; their `source_template_key` is provenance, not authority. Existing scoped V1 memberships are bootstrapped once, idempotently and audibly, through their legacy role. Bootstrap seeds templates/defaults only during initial permission-state creation and never rehydrates later organization customization.

Permission administration locks the organization inside the caller's transaction, applies a current-capability grant ceiling, verifies that at least one active Staff principal retains both `permissions.manageSets` and `permissions.assignStaff`, writes a compact correlated audit event, and increments the authority revision. Semantic no-ops create no revision or history noise. Permission management alone cannot grant or revoke capabilities the acting administrator does not currently hold. Delegated AI GO-time revalidation is bound to the originally approved Staff actor and organization and intersects fresh Staff authority with the approved delegation ceiling.

The administration persistence component records correlation and business-request identity but is not itself the public exactly-once application boundary. Any future HTTP, AI, or service operation exposing permission mutation must reserve/replay the business request through the proven M0 operation-request coordinator before invoking it.

Migration 0186 serializes deferred final-admin checks on the organization row and advances authority revision for committed legacy-membership authority changes. This prevents write-skew through the storage-level membership, assignment, set, and capability backstop.

The guarded clone rehearsal requires `V2_M0_POSTGRES_INTEGRATION=1` and `TEST_DATABASE_URL`. Final validation executed every supported Staff authority-reduction path; three deterministic administration races; three deterministic membership-floor races; stale/no-op revisions; rollback after mutation, Audit, and revision; correlated semantic Audit history; delegated-AI revalidation; bootstrap non-rehydration; migration/catalog postconditions; and the original Staff/Portal/bootstrap/isolation regression.

M1.5 physical readiness is **PASS — READY FOR M1.6**.

M1.5 adds no commercial writer, HTTP endpoint, UI, or deployment. Next milestone: **M1.6 — Commercial Persistence Design** (do not begin it here).
