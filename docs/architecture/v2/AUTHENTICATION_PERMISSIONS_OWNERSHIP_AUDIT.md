# Authentication / Permissions Ownership Audit

## Status and conclusion

This is an architecture and repository-forensics audit. It defines V2 authentication and permission ownership without implementing a permission system, M1, migrations, runtime changes, database writes, or deployment.

The V2 decision is a configurable **permission-set switchboard** on top of M0's Principal, PrincipalIssuer, and pure AuthorityPolicy. A permission set is a named organization-scoped collection of operation capabilities. It is not a hard-coded Owner/Admin/Employee branch. Authority is:

    verified Identity + Principal type + authoritative resource scope
    + assigned permission set capabilities + small platform safety ceilings
    = AuthorityPolicy decision

M0 remains intact. HTTP/browser/provider input authenticates identity but never supplies trusted Staff role/capability claims. The issuer resolves authority server-side; named application operations enforce it; repositories enforce storage scope/integrity, not user role policy.

## 1. Current V1 identity and authentication map

| Concern | Current V1 reality | V2 disposition |
| --- | --- | --- |
| Staff login/session | Passport local login, PostgreSQL-backed express sessions, serialized user ID, DB reload on deserialize in server/localAuth.ts | REUSE BEHIND PRINCIPAL ISSUER |
| Credentials | auth_identities holds provider/password hash; users is profile/account record | REUSE BEHIND PRINCIPAL ISSUER |
| Request identity | req.user is session-loaded user; /api/auth/session returns user shape to UI | REUSE AS IDENTITY ONLY |
| Active organization | server/tenantContext.ts resolves header, last active org, default, or sole membership and rejects disabled orgs | REUSE BEHIND PRINCIPAL ISSUER |
| Development convenience | localAuth and tenantContext can auto-create/provision users/memberships outside production | REMOVE FROM V2 AUTHORITY |
| Portal session | Same session mechanism, but customerPortalAccess resolves active customer/org access | REUSE BEHIND PORTAL ISSUER |
| Staff portal preview | A non-Portal Staff session can enter an audited, read-only customer portal preview context | RECONSTRUCT OR REMOVE; never issue it as a normal Portal Principal |
| Platform gates | Fresh DB checks of isPlatformAdmin/isPlatformDeveloper for platform routes | KEEP AS NARROW PLATFORM AUTHORITY |

Local sessions are an acceptable initial V2 authentication adapter. The session establishes only an authenticated subject. PrincipalIssuer must look up the active valid membership/access record, organization, permission assignments, and scope from trusted server-side data for each issuance or bounded cache period.

## 2. Current role and permission persistence

V1 has no single permission authority.

- user_organizations is the closest current tenant authority: composite user/organization membership with owner, admin, manager, or member and default flag in shared/schema.ts. tenantContext derives req.orgRole from it.
- users also has global role, isAdmin, isPlatformAdmin, isPlatformDeveloper, accountType, and lastActiveOrgId. users.role allows employee while membership does not, creating a semantic mismatch.
- customer_portal_access stores organization/customer/contact/user, lifecycle status, and COMPANY_ADMIN, BUYER, BILLING, or VIEWER accessRole.
- Fixed role-to-grant maps exist in shared/organizationRoleAuthority.ts and AI command metadata.
- API keys found in V1 are predominantly outbound provider credentials, not a general incoming caller credential/Service Principal model.
- Organization settings/feature flags sometimes control availability, but they are configuration, not permission grants.

The future canonical source is membership/access assignment to permission sets. Legacy role/global fields are compatibility inputs during coexistence only.

## 3. Current authorization enforcement and frontend gating

Authorization is fragmented across route middleware, route-local conditions, services, repositories, AI registry metadata, and UI. Read-only inspection found 629 references in 41 route modules to isAdmin, isAdminOrOwner, requireOrgOwnerAdmin, assertInternalUser, or role fields.

Important examples:

- server/routes.ts and server/lib/orgPermissions.ts encode owner/admin/manager/member invitation and assignment matrices.
- server/localAuth.ts and server/replitAuth.ts retain global isAdmin middleware; shared/roleAccess.ts may accept object isAdmin as an operational fallback.
- Pricing, production, procurement, settings, proofing, and attachments routes use different injected admin/owner guards; server/routes/pricing.routes.ts is a representative direct isAdmin CRUD boundary.
- server/storage/quotes.repo.ts contains role-aware access filtering, which is repository-level business authorization leakage.
- server/services/assistant uses allowedRoles and static role-to-grant mapping alongside Plan/GO checks.
- client/src/hooks/useAuth.ts exposes global flags; useActiveOrganizationRole.ts, App.tsx, navigation, quote, production, settings, and admin components gate UI with role checks.

Frontend checks are presentation only: page/tab/button visibility, editable controls, and navigation availability. They are useful UX inputs but never enforcement. A future UI asks the backend for available actions/operation metadata; the same operation still invokes AuthorityPolicy on the backend. Status remains truthful: a user without invoice.editIssued simply sees an issued invoice without editable controls or distracting lock warnings.

## 4. Portal/customer current model and target model

V1 portal access is structurally safer than its role model:

- customerPortalAccess has active/suspended/disabled lifecycle and binds a user/contact to one organization/customer.
- portalContext derives organization and customer scope from server-side access, while tenantContext blocks portal identities from internal routes.
- portal routes apply portal context and default-deny non-portal APIs; scoped DTO/file/proof checks are valuable characterization evidence.
- accessRole is persisted but has little evidence of action-level backend enforcement, so it is not a V2 capability model.
- tokenized proof URLs are a separate anonymous resource-token flow; they must not become a broad Portal Principal.

### Target Portal policy

A Portal Principal is issued only from active customer access. It always has organization and customer-account scope. Its effective authority is:

    platform safety ceiling
    intersection customer-account capability ceiling
    intersection additive Portal-user permission-set grants
    intersection actual resource organization/customer scope

This supports both required cases without deny semantics:

- Customer ABC cannot place orders: remove orders.create from ABC's account capability ceiling, so no ABC portal user can receive it.
- ABC may order but Susan is view-only: ABC ceiling permits it, but Susan has only Customer View Only set, so she lacks orders.create.

Use additive set union within a layer. The customer account policy is a ceiling, not another unbounded grant source. A missing customer ceiling uses the tenant's portal default ceiling; explicit account policy only narrows. No explicit deny permissions are needed initially: removing a grant or narrowing the account ceiling is predictable and auditable.

Customer/account relationship truth remains Customers/CRM. Authentication/Permissions owns permission-set assignment/effective resolution; Portal owns customer-facing UX and calls canonical operations. Customer-admin self-service is deferred; when introduced it remains confined to the same customer scope and to a tightly limited portal-user administration capability.

V1 staff portal preview (`server/services/staffPortalPreviewService.ts`, `server/tenantContext.ts`, and `server/routes/portal.routes.ts`) is not a general Portal entitlement. Although it is currently read-only and audited, it switches a Staff session into customer context. V2 must reconstruct it only after defining a separate, Staff-authorized, customer-scoped, short-lived read-only preview principal/session with clear attribution, or remove it. It must never manufacture a normal Portal Principal or silently give Staff customer authority.

## 5. Staff permission-set model

A Staff user may have multiple permission sets for a membership. Sets combine additively within that membership. The same person may have different sets in different organizations. This supports Sales plus Production without a synthetic combined role.

Initial rules:

- Permission assignments are attached to an organization membership, not global users.
- An administrator may create, edit, activate, assign, or deactivate only sets and assignments within its explicitly authorized permission-administration boundary. It cannot expand its own effective authority, directly or by editing/assigning a set it holds, unless a separately authorized higher-administration operation permits that change.
- Multiple sets union their capabilities. No explicit user-level grant/deny overrides in the first V2 model.
- Explicit deny is rejected initially. Deny-overrides-allow creates ambiguous administration, debugging, and AI delegation behavior; remove an assignment or use a narrower set instead.
- A named Owner template is a useful seed, not a magic hard-coded business role. It can be duplicated and adapted, while platform safety ceilings remain outside it.
- All permission-set, membership, assignment, customer-ceiling, and service-capability changes create meaningful Audit/History events.

Sales-representative own-record and production-station scopes are deferred until an actual operation needs them. They should be added as named scope rules, not inferred from a role label.

## 6. AI delegation model

Delegated AI is a distinct Principal, not a privileged Staff user. Its effective authority is:

    verified current Staff capabilities
    intersection AI command's allowed capabilities
    intersection fresh Plan/GO/revalidation/expiry restrictions
    intersection actual organization/customer/resource scope
    intersection platform safety ceilings

M0 AuthorityPolicy already checks that a delegated AI cannot widen its underlying Staff capability and requires approved, fresh delegation. V1's valuable behavior contracts are server-derived actor/org binding, stored proposal/turn ownership, one-time confirmation, expiry, optimistic plan version, revalidation before execution, idempotent replay, and meaningful audit.

A model response, browser page role, prompt, cached plan, or provider-supplied permission field is never authority. At GO, PrincipalIssuer must freshly re-resolve the Staff membership, active assignments, scope, and authority revision before constructing the delegated Principal; it must not trust the saved plan's embedded Staff capability snapshot. AI records its principal/agent and plan/request identity alongside the verified Staff delegator; Portal and Service never fabricate a Staff actor. The target operation still enforces its authority and business invariants after AI revalidation.

## 7. Service/API and integration credentials

There is no general V1 incoming API-key/Service Principal system to reuse. V2 ServicePrincipal therefore needs deliberate issuance, not adaptation of Stripe, email, AI-provider, or other outbound secrets.

A V2 service credential resolves to one Service Principal with explicit client identity, organization binding, capability set, resource/audience scope, expiry, rotation/revocation, and operation idempotency. It never impersonates Staff and cannot gain database-wide or unbounded tenant authority. M0 currently represents ServicePrincipal with organization, client, and capabilities only; resource and audience restrictions are required V2 extensions before any Service mutation is introduced, not protections M0 already enforces.

Local Bridge is a narrow Integration credential, not a general Service Principal precedent. server/routes/localBridge.routes.ts verifies a bearer-token hash to an active organization-bound agent and limits work claim/download/report to that agent/job/organization. Preserve outbound-only, least-privilege transport; source modules authorize the handoff, and the bridge does not receive blanket business capabilities.

MCP has no current V1 in-repository service authority model. If introduced, Integrations owns external transport, Authentication validates a short-lived audience/tool-allowlisted delegation, and AI/canonical operations retain confirmation, scope, and business authority.

## 8. Platform administration and hard safety ceilings

Platform authority and tenant business authority are separate. M0 has no platform Principal kind because M0 operations are organization-bound. Before a V2 platform-control operation exists, Authentication/Permissions must define a distinct platform-control principal/policy boundary (or equivalently isolated, separately issued context). It must not manufacture an organization StaffPrincipal or use tenant permission sets to represent platform authority.

isPlatformAdmin/isPlatformDeveloper may authorize narrowly defined platform-control operations, such as tenant lifecycle review, platform security/credential administration, developer diagnostics, and infrastructure controls. They must not mint a StaffPrincipal or silently grant Sales, Billing, Production, or CRM authority for every tenant.

The smallest justified hard safety ceilings are:

- organization/tenant boundary: no cross-tenant read or mutation by tenant principals;
- principal-kind separation: Portal, Service, and AI cannot masquerade as Staff;
- delegated AI subset, fresh approval, expiry, and revalidation;
- credential audience, expiry, rotation, and revocation;
- protected platform operations: tenant destruction/ownership transfer, system-wide configuration, secrets/credential root operations, infrastructure/developer/debug deployment controls, and any future support-impersonation initiation;
- no arbitrary SQL, backend-call, API/tool execution, or permission-system recovery escalation through ordinary tenant grants.

Support impersonation is not an existing V2 entitlement. If later required, it needs a separate platform operation, explicit target/scope, reason, short expiry, visible attribution, and audit; it does not silently become tenant Staff authority.

## 9. Scope, capabilities, and module ownership

### Scope model

The initial application-level scopes are organization, customer account, specific resource, and platform. Staff is organization-scoped through membership; Portal is organization plus mandatory customer scope; Service will be explicitly organization/resource/audience scoped once that extension exists; delegated AI inherits the delegator scope and further narrows it.

Operations load the actual resource with organization/customer predicates before or while authorizing. Create, attach, move, and reassignment operations must instead derive or validate the prospective target organization/customer/resource scope before mutation; a Portal caller with `orders.create` cannot submit another customer's ID. Referenced resource IDs are resolved through their owning module's scoped contract, not treated as client-trusted links. Cross-tenant/customer callers receive a scoped not-found response to avoid existence leakage. An authenticated in-scope principal lacking capability receives forbidden/capability-not-granted. M0's validation, not-found, forbidden/scope, conflict, retryable, and internal error taxonomy remains the public-safe baseline.

Assigned jobs, own-record-only, and station scope are deferred. Production assignment is initially a business workflow fact rather than permission scope unless a concrete authorization requirement proves otherwise.

### Capability principles

A capability names a business operation, not a UI element. The owning module declares it with a stable ID, label/description, applicable principal kinds, resource-scope requirement, and negative policy test. Authentication/Permissions owns set assignment and evaluation framework, not foreign business semantics. The vocabulary is static and typed in code for M1-era safety; it may be extended through reviewed module changes, not runtime-pluggable magic.

Representative initial vocabulary, intentionally not exhaustive:

| Owner | Initial operation capabilities |
| --- | --- |
| Sales | quote.view, quote.create, quote.edit, quote.send, quote.convert, order.view, order.create, order.edit, order.cancel |
| Products / Pricing | product.view, product.edit, pricing.configure, pricing.preview, pricing.publish |
| Customers | customer.view, customer.edit |
| Artwork / Prepress | artwork.view, artwork.upload, artwork.replace, proof.view, proof.respond, prepress.prepare |
| Production / Routing | production.view, production.start, production.complete, route.view, route.reroute |
| Inventory / Procurement | inventory.view, inventory.adjust, inventory.receive, procurement.manage |
| Fulfillment / Shipping | fulfillment.view, fulfillment.pickup, shipping.create |
| Billing | invoice.view, invoice.editDraft, invoice.editIssued, invoice.issue, payment.record, refund.issue |
| Reporting | report.operational.view, report.financial.view |
| Settings / Integrations | settings.view, settings.edit, integrations.manage |
| Bug Reporting / AI | bug.report, bug.manage, ai.use, ai.manage |

Modules add more only with the named operation, scope contract, policy decision, and tests. Business distinctions matter: proof.respond, payment.record, refund.issue, route.reroute, production.complete, and invoice.issue are preferable to generic update permissions.

## 10. Permission-set persistence, administration, caching, and audit

Conceptual relational persistence, not a migration prescription:

- permission_sets: immutable ID, organization ownership or immutable system-template origin, name, description, active state, revision, and template provenance.
- permission_set_capabilities: normalized set-to-static-capability relation.
- membership_permission_set_assignments: membership, set, active state, assignment audit; an assignment can later carry a narrowly defined scope only when required.
- portal_permission_set_assignments: portal access, set, active state, assignment audit.
- customer_portal_capability_ceiling: customer account policy/capability relation or policy-set reference.
- service principal and service capability assignments: separate credential/client lifecycle.
- permission revisions and Audit/History correlation, not full permission-database snapshots.

System templates are seedable/clonable defaults such as Owner, Administrator, Sales, Production, Accounting, Customer Full Portal, and Customer View Only. They are not magic immutable roles. Global templates are immutable catalog/seed data: an organization may edit only an organization-owned clone. Every set assignment and customer-ceiling relationship validates same-organization ownership. Safe bootstrap/recovery must guarantee that an organization never loses all active permission-administration authority: under a transaction/appropriate lock, every authority-changing path--capability removal, set deactivation/deletion, assignment revocation, membership deactivation, and applicable customer-ceiling change--evaluates the post-change effective state and rejects removal of the final administrator unless a documented, separately authorized recovery flow is used.

Permission administration needs capabilities such as permissions.view, permissions.manageSets, permissions.assignStaff, permissions.assignPortal, and service.manageCapabilities, introduced only with their operations. It is unavailable to Portal users until an explicitly designed customer-scoped self-administration model exists; future customer administration must not configure customer ceilings or platform/staff permission sets. Changes record actor/delegator, organization/customer, affected set/assignment, capabilities added/removed, prior/next active status, reason where required, and correlation/request ID. Audit does not dump every permission table on every change.

Resolve authority at request time initially. A short-lived server cache may be introduced later only with permission-set revision/session authority version validation. Session UI data is not a grant cache: permission changes must invalidate/reissue principal context on the next request or bounded refresh without requiring Redis.

## 11. UI switchboard and operation boundary

The switchboard UI groups server-defined capability metadata by module, shows readable labels/descriptions, lets authorized administrators create/duplicate/name/activate sets, toggle capabilities, assign them to Staff or Portal access, and inspect effective permissions. Metadata is presentation support; typed module capability declarations remain authoritative.

UI receives allowed actions/navigation state from a scoped backend DTO. It can hide controls and disable editing without pretending that a protected resource state changed. Backend flow is mandatory:

    interface adapter
      -> PrincipalIssuer
      -> AuthorityPolicy
      -> named application operation
      -> organization-scoped repository

Repositories require organization scope and protect storage integrity/resource ownership. They do not decide whether a caller is an Admin, Sales user, or Portal buyer. Interface adapters do not import repositories/raw DB or bypass named operations, preserving M0 import boundaries.

## 12. V1 reuse, reconstruction, and test evidence

| Current concept | Classification | V2 treatment |
| --- | --- | --- |
| Passport local session and auth_identities | REUSE BEHIND PRINCIPAL ISSUER | Authenticate identity only |
| tenantContext active-membership/org resolution | REUSE BEHIND PRINCIPAL ISSUER | Server-side scope resolution; remove dev auto-provision behavior |
| user_organizations membership source | REUSE BEHIND COMPATIBILITY READER | Temporary legacy role-to-set mapping only |
| users.role/users.isAdmin tenant checks | RECONSTRUCT / RETIRE | No V2 tenant business authority |
| platform admin/developer checks | KEEP, NARROWED | Platform-only ceiling operations |
| orgPermissions fixed role matrix | RECONSTRUCT | Permission-set administration operations |
| portal context and scoped DTO/file behavior | REUSE BEHIND PORTAL ISSUER | Customer scope remains mandatory |
| portal accessRole | RECONSTRUCT | Map to configurable Portal sets; no direct V2 meaning |
| AI Plan/GO/revalidation/attribution | REUSE BEHIND V2 CONTRACT | Delegated principal intersection |
| AI allowedRoles/static grants | RECONSTRUCT | Capability + scope contracts |
| route/service/repository role checks | RETIRE FROM V2 | Canonical operations only |
| UI role/global-flag gating | RECONSTRUCT | Backend availability DTO; presentation only |
| Local Bridge token/job scoping | REUSE BEHIND INTEGRATION CONTRACT | Narrow transport principal/credential |
| provider API keys as identity | REMOVE | Outbound secrets are not caller authority |

Useful characterization assets include tenantAuthorizationRoleSource.contract.test.ts, remainingTenantAuthorization.contract.test.ts, adminOwnerPermissions.contract.test.ts, orgInvitePermissions.unit.test.ts, organizationRoleAuthority.test.ts, assistantActorAuthorityResolver.test.ts, canonicalCapabilityRegistry.test.ts, assistantExecutionPlanningService.test.ts, portalContractBoundary.test.ts, portalProofBoundary.test.ts, customerPortalAccessPolicy.test.ts, and existing scoped Portal quote/order/proof/file tests.

Replace route-wiring/source-string tests with Principal/AuthorityPolicy matrices covering Staff/Portal/Service/AI, positive and negative organization/customer/resource scope, platform separation, stale authority, plan expiry, same-operation interface parity, and lockout prevention.

## 13. Target V2 authority architecture

1. **Identity** is an authenticated subject/session/credential, without trusted business authority claims.
2. **Principal** is trusted, server-issued operation context: Staff, Portal, Service, or delegated AI.
3. **Permission Set** is a named organization-scoped group of operation capabilities.
4. **Capability** is a typed, module-owned business-operation identifier.
5. **Scope** is authoritative organization/customer/resource/platform reach for that principal.
6. **AuthorityPolicy** is pure and decides capability plus actual resource scope and M0 AI constraints.
7. **PrincipalIssuer** transforms verified identity into a scoped Principal through server-side membership/access/assignment resolution.
8. **Staff assignments** attach one or more additive sets to an organization membership.
9. **Portal assignments** attach additive sets to active portal access and are narrowed by a customer-account ceiling.
10. **AI permissions** are intersection-only delegation from verified current Staff authority plus Plan/GO constraints.
11. **Service permissions** are explicit client capability/scope grants; no Staff impersonation.
12. **Platform administrators** require a separate platform-control principal/policy before platform operations exist and never receive automatic tenant business authority.
13. **Hard ceilings** are tenant/principal separation, AI/credential safety, and a small protected platform-operation set.
14. **Permission changes** are meaningful Audit/History events with truthful principal/delegator attribution.
15. **UI** receives scoped action availability; it never authorizes.
16. **Backend enforcement** occurs in AuthorityPolicy and named operations before repository work.
17. **Persistence** is normalized set/capability/assignment/policy data with revisions and audit.
18. **V1 reusable assets** are sessions, verified membership/portal scope, AI safety lifecycle, and scoped portal/bridge behavior.
19. **Reconstruction** is required for fixed role matrices, global tenant admin flags, Portal role semantics, API/service issuance, and scattered guards.
20. **Retire** V2 dependence on global role/isAdmin fallbacks, UI-only enforcement, and repository business-role filtering.

## 14. Safe implementation sequence, risks, and exit criteria

### Five highest-risk migration points

1. Legacy user role/isAdmin and membership role disagree; a compatibility map can silently broaden or narrow authority.
2. Portal accessRole is lifecycle data without proven per-action enforcement; migration must not accidentally grant ordering/payment.
3. Global platform flags and isAdmin fallbacks can become cross-tenant escalation if issued as Staff authority.
4. AI legacy static grants/shadow behavior may be broader than verified Staff authority.
5. Cached session/UI role data, repository role filters, route bypasses, and unconstrained permission administration can preserve stale/alternate policy, enable self-escalation, or concurrently remove the final administrator.

### Safe future sequence

1. Freeze authorization characterization and negative-scope tests.
2. Define the small typed module capability vocabulary and operation/scope metadata.
3. Define permission-set/read/effective-authority DTOs and compatibility mapping decisions.
4. Add V2 permission-set persistence and assignment administration with audit/lockout protection.
5. Implement effective capability resolution and revision-aware request-time principal issuance.
6. Connect PrincipalIssuer and pure AuthorityPolicy without weakening M0.
7. Migrate one bounded module operation and its UI availability DTO; prove Staff matrices.
8. Add Portal customer ceiling/Portal assignments and same-operation scope matrices.
9. Add Service issuance and AI delegated intersection/revalidation adapters.
10. Retire V2 use of V1 route/service/repository role checks only after parity and cutover evidence.

### Exit criteria

- Capability IDs are owned by named operations with scope and negative tests.
- Staff, Portal, Service, and AI effective-authority matrices are approved.
- Legacy role/global-field mapping decisions are explicit, tested, and time-limited.
- Customer account ceiling and Portal-user assignment behavior is approved.
- Permission administration cannot self-expand outside its management boundary or remove the final effective administrator without transactional safe recovery.
- Principal issuance validates active membership/access, organization/customer scope, and revision freshness.
- Platform access is demonstrably separate from tenant business authority.
- Service mutations wait for explicit resource/audience scope enforcement, and delegated AI reissues current Staff authority at GO.
- V2 interfaces cannot bypass operations/repositories and stale authority is bounded.

## 15. Open product decisions and explicit answers

Open decisions: exact initial permission-administration boundary and bootstrap/recovery authority; whether customer admins manage their own Portal users; which financial/reporting distinctions require separate capabilities; service credential issuance/revocation UX and resource/audience scope representation; Staff portal preview/support-impersonation approval and re-auth policy; platform-control principal representation; and whether own-record or station scope is needed after real operation evidence.

- **Does V1 currently have one permission authority?** No. Membership role, users.role/isAdmin, platform flags, Portal access role, route/service checks, AI mappings, repositories, and UI all contribute.
- **Where are the biggest inconsistencies?** Global isAdmin versus membership role, fixed role vocabulary mismatch, route/service/repository policy scattering, Portal role storage without action enforcement, and AI static grants versus current actor authority.
- **Can current Staff authentication be reused behind PrincipalIssuer?** Yes. Passport/session/auth_identities and verified tenant membership are useful identity/scope adapters; request claims and development provisioning are not authority.
- **One or multiple Staff sets?** Multiple additive sets per organization membership.
- **Explicit deny permissions?** No initial deny model; use additive sets plus assignment removal and Portal customer ceilings.
- **How do customer and user permissions combine?** User Portal sets union within the user layer, then intersect with the customer account ceiling and actual resource scope.
- **How do changes invalidate stale authority?** Request-time resolution first; later short cache only with assignment/set revision and session authority-version invalidation.
- **What does platform/global admin mean?** Separate platform-control authority, never automatic tenant Staff/business authority.
- **Which actions remain outside tenant-configurable sets?** Tenant/principal boundaries, AI/credential ceilings, protected platform operations, secret/infrastructure/developer controls, and future support-impersonation initiation.
- **Can AI authority be entirely delegated intersection?** Yes: verified current Staff grants intersect AI command allowance, Plan/GO/freshness, scope, and ceilings.
- **Can Portal and Service use the same operations?** Yes, through typed principals and scope; interfaces only adapt input/output.
- **What is the first implementation prompt?** “Define the V2 Auth/Permissions capability and effective-authority contracts: static module-owned capability metadata, normalized permission-set/read DTOs, Staff and Portal assignment resolution, customer capability ceiling, revision-aware PrincipalIssuer inputs, and AuthorityPolicy matrix tests. Do not add migrations, V1 routes, or production writers.”
