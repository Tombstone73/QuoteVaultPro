# M1.4 Temporary Staff Authority Compatibility

> **THIS IS TEMPORARY COMPATIBILITY INFRASTRUCTURE.** The final V2 authority model is configurable, organization-scoped permission sets. This adapter must be replaced in **M1.5 — Permission-Set Foundation**.

## Purpose and trusted source

M1.4 permits early V2 DEV/test read and calculation flows to issue a typed M0 `StaffPrincipal` from one fresh, trusted V1-schema membership read. The only tenant-role source is `user_organizations.role`, resolved for the authenticated server-side user ID and the requested organization in the same query. The organization selection is not an authority claim: the reader binds both values and validates the membership.

The compatibility reader joins `user_organizations` to `organizations`; it never reads `users.role`, `users.is_admin`, `users.is_platform_admin`, or `users.is_platform_developer`. It also never calls V1 `tenantContext`, whose non-production auto-provisioning is not valid V2 authority. The legacy join table has no membership lifecycle/status or surrogate ID: row absence is removed/inactive membership and the issued membership reference is a deterministic SHA-256 compatibility reference, not a fabricated database ID.

An organization is eligible only when `delete_state = active`, it is not archived, and its status is `active` or `trial`. `suspended` and `canceled` are rejected. Treating suspended/canceled organizations as disabled is an **INTENTIONAL V2 AUTHORITY CORRECTION**; V1 tenantContext currently does not fully use `organizations.status`.

## Bounded role-to-capability map

Only the four persisted membership roles are accepted: `owner`, `admin`, `manager`, and `member`. Case/whitespace variants, `employee`, missing values, and unknown roles fail closed. The old M0 plural seeds (`orders.create`, `quotes.convert`) are not granted.

| Membership role | Temporary V2 capabilities |
| --- | --- |
| Owner / Admin | `customer.view`, `product.view`, `pricing.preview`; all early Quote/Order operations (`quote.view/create/edit/send/convert`, `order.view/create/edit/cancel`); `invoice.view`, `invoice.editDraft`, `invoice.issue` |
| Manager | Read/calculation capabilities; Quote create/edit/send/convert; Order create/edit; `invoice.view`, `invoice.editDraft` |
| Member | Read/calculation and commercial-view capabilities only: `customer.view`, `product.view`, `pricing.preview`, `quote.view`, `order.view`, `invoice.view` |

Manager lacks `order.cancel` and `invoice.issue`; Member lacks all commercial mutation capabilities. These are deliberate early-M1 ceilings, not an attempt to preserve every V1 role path. No Product editing, payment/refund, Production, Routing, Inventory, Settings, Integrations, AI, Portal, or Service capabilities are granted.

## Issuance and scope

`TemporaryStaffCompatibilityPrincipalIssuer` implements M0 `PrincipalIssuer` and the typed `StaffPrincipalIssuer` extension. It accepts only authenticated `session` identities; `portal_session` and `service_credential` identities cannot mint Staff Principals. It reads membership on every issuance, then emits a frozen Staff Principal with the real authenticated subject, one organization, bounded capabilities, source marker, and membership/organization update revision.

`AuthorityPolicy` remains unchanged and is the only capability/scope decision point. The compatibility issuer does not decide resources. A principal issued for Org A cannot authorize an Org B resource; a user with distinct Org A and Org B memberships receives separately resolved capabilities. A delegated-AI principal remains constrained by the existing M0 Staff subset/freshness rules; M1.4 adds no AI authority path.

## Freshness, failure, and retirement

The issuer does not cache role/capability state in session data. A role change, membership deletion, organization lifecycle change, or organization switch is read on the next issuance. Missing membership returns a scope-safe failure; disabled membership/organization or unsupported role returns a typed M0 `FORBIDDEN` result without exposing unrelated tenant information.

The adapter exposes the non-date-based replacement marker `M1.5 — Permission-Set Foundation`. `v2:boundaries` mechanically rejects any production V2 import of the temporary role resolver outside its approved Staff Principal issuer. The focused tests assert this marker, exact role capability sets, immutable issued authority, no global/platform fallback, organization scope, freshness, and `AuthorityPolicy` decisions.

## Verification and PostgreSQL rehearsal

`v2/tests/modules/staffAuthorityCompatibility.test.ts` covers the pure issuer, scoped reader query, V1 global-flag negative cases, role changes/removal, disabled authority, and policy outcomes. `npm run v2:m1:staff-authority` is a clone-only transactional rehearsal: it creates temporary globally flagged users and two memberships, proves flags cannot bypass membership, verifies cross-organization role differences, role freshness, removal, and suspended-organization rejection, then rolls back.

The runner requires exactly M0’s explicit `TEST_DATABASE_URL` and `V2_M0_POSTGRES_INTEGRATION=1`; it has no database fallback and logs no credentials.

## Exclusions and next step

This milestone does not create permission sets, permission assignments, Portal ceilings, Service credentials, AI grants, UI/HTTP business routes, Sales/Quote/Order/Billing writers, or migrations. It reuses only the compatible schema’s authenticated subject and membership/organization facts; it excludes V1 route middleware, `roleAccess`, `organizationRoleAuthority`, `tenantContext`, and service authorization logic.

**Next milestone: M1.5 — Permission-Set Foundation.** It replaces this compatibility map with configurable named permission sets and assignment/effective-resolution persistence. It does not begin here.
