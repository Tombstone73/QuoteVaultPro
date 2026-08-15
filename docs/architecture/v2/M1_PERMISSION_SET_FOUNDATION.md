# M1.5 — Permission-Set Foundation

M1.5 replaces M1.4's temporary Staff-role runtime map. Normal V2 Staff and Portal issuance resolves only active, organization-scoped V2 permission-set assignments. A missing V2 assignment fails closed; `user_organizations.role`, global user flags, and `customer_portal_access.access_role` are never runtime authority.

Permission sets are organization-owned, additive capability sets. Staff receive the union of their active assigned sets. Portal receives assigned-set union intersected with either an explicit customer ceiling or the organization’s explicit safe default ceiling, then `AuthorityPolicy` enforces the customer scope. There is no deny algebra, wildcard administrator, or cross-organization ID lookup.

The static capability catalog is normalized and FK-backed. Global immutable templates seed editable organization-owned set copies; their `source_template_key` is provenance, not authority. Existing scoped V1 memberships are bootstrapped once, idempotently and audibly, through their legacy role. New organization provisioning must use the same dedicated bootstrap operation, never request-time role fallback.

Permission administration locks the organization inside the caller’s transaction, applies a current-capability grant ceiling, verifies that at least one active Staff principal retains both `permissions.manageSets` and `permissions.assignStaff`, writes a compact audit event, and increments the authority revision. Permission management alone does not allow granting capabilities the acting administrator does not already hold.

M1.5 adds no commercial writer, commercial migration, HTTP endpoint, UI, or deployment. The guarded clone rehearsal requires `V2_M0_POSTGRES_INTEGRATION=1` and `TEST_DATABASE_URL`; without an authorized migrated clone, physical readiness is **PENDING CLONE VALIDATION**.

Next milestone after clone PASS: **M1.6 — Sales/Quote writer implementation** (do not begin it here).
