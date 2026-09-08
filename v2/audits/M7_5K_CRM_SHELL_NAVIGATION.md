# M7.5K — CRM activity and shell/navigation convergence

## Scope and disposition

M7.5K completed the bounded staff-facing visibility work on `dev`. It adds
read-only CRM context, a capability-filtered operational shell, and a small
server-owned Command Center. It does not change any business workflow,
provider integration, database schema, or customer Portal behavior.

Disposition: **PASS WITH FINDINGS — deployable but not live-validated.**

## Customer activity/read model

`PostgresCustomerWorkspaceReader.activity` is a keyset-paginated, tenant and
Customer scoped projection. It reads immutable/current facts from the owning
V2 domains and does not create a CRM copy of Sales, Billing, Proofing, or
Fulfillment data. It includes Quotes, Orders, Invoices, Payments, Refunds,
Proof versions, and completed pickup/shipment handoffs.

The payment branch uses an allocation `EXISTS` predicate, so one payment that
has several allocations for the same Customer appears once. Cursor ordering is
deterministic: `(occurred_at, kind, entity_id)` descending. Provider internals,
worker diagnostics, and cross-Customer data are excluded.

`GET /v2/organizations/:organizationId/customers/:customerId/activity` requires
`customer.view`, resolves the Customer under the active organization first,
and then returns only its bounded activity. The Customer detail Activity card
links to the relevant owner workspace; it contains no duplicate mutations.

## Route and navigation inventory

| Area | M7.5K state |
| --- | --- |
| Customers, Quotes, Orders, Products, Formula Library | Complete and capability-filtered |
| Inbound Orders, Proofing, Prepress | Complete and capability-filtered |
| Production, Flatbed, Roll, Fulfillment | Complete and capability-filtered |
| Inventory, Invoices, Payments, Routing | Complete and capability-filtered |
| QuickBooks, Users & Permissions, Settings | Exposed via their completed Settings sections and capability-filtered |
| Customer Portal | Separate customer entry/auth surface; not represented as a staff sidebar module |
| Nesting, Materials, Procurement, Design, Shipping, Reports, AI, Communications, Integrations, Bug Reports | Incomplete/future or not a current V2 workspace; hidden rather than advertised |

The shell now receives the authenticated capability snapshot. Hiding a link is
only navigation convenience: every destination continues to enforce its own
server/workspace authorization. The New menu also only presents Quote/Order
creation actions when the related create authority exists.

## Command Center and action indicators

The staff landing page now reads one `/action-center` projection instead of
combining several client workspace queries. The route first resolves the
authenticated principal and filters categories with the existing authority
policy. The PostgreSQL reader uses one static, organization-bound statement for
only the permitted categories:

- Inbound records needing review, retry, or action.
- Current proof versions with a revision request.
- Incomplete Prepress units.
- Production work whose completed good quantity is still below its requirement.
- Non-void invoices with a positive derived balance.

Each card links to its owning workspace. This is a current-action summary, not
analytics, scheduling, notification delivery, or a replacement state machine.

## Global search and preferences

Global search remains **deferred**. The current per-domain read contracts are
safe individually but do not form one canonical, capability-aware,
permission-filtered, deterministic ranking contract across Customers, Contacts,
Quotes, Orders, Invoices, and Products. A React-side merger would risk leakage,
inconsistent authorization, and unbounded fanout, so the inert search control
was removed rather than presented as available.

The existing appearance/sidebar preference remains unchanged. M7.5K did not
persist business content, filters, or tenant-sensitive state in browser
storage, and did not create another preference system.

## RBAC and security

- Customer activity is gated by `customer.view`, resolves its Customer within
  the authorized organization, and does not expose a cross-tenant existence
  oracle.
- Action-center categories are evaluated server-side against the authenticated
  principal. A foreign organization fails closed before the reader runs.
- Shell visibility is based on the capability snapshot; it is not relied upon
  as authorization.
- The action summary returns counts and owner routes only; it exposes no
  provider payloads, worker state, customer secrets, or internal diagnostics.

## Deliberate deferrals and remaining gaps

- Global cross-entity search needs a dedicated canonical search/read contract
  with object-level authorization and bounded deterministic ranking.
- Notification delivery and user-specific notification state need a canonical
  notification authority; no polling/badge system was invented.
- CRM communications and staff document history remain absent until their
  canonical source/read contracts exist.
- Authenticated DEV validation, provider validation, Gmail read-scope
  authorization, multi-invoice refund allocation behavior, and M7 cutover
  control-plane evidence remain outside this source-only milestone.

## Validation

`npm` is unavailable in this environment. Direct equivalents were used:

- Root, V2, and UI TypeScript projects compiled with `tsc --incremental false`.
- The V2 import-boundary check and Vite UI production build passed.
- Focused Jest coverage passed with `TEST_DATABASE_URL` explicitly empty:
  Customer activity reader/route and action-center reader/route (10 tests).
- Customer workspace, visual-shell navigation, sales-entry, and product-routing
  UI contracts passed through `tsx`.
- `git diff --check` passed. Authenticated DEV validation remains pending.

No provider, DEV, or production calls were made. MAIN remains untouched.
