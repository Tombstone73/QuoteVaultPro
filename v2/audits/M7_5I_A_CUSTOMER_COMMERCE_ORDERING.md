# M7.5I-A — Customer commercial authority and portal ordering

## Scope and disposition

This is the first coherent Customer Portal foundation boundary. It adds
customer-scoped catalog entitlement, immutable customer pricing-agreement
history, one canonical Sales pricing path, and authenticated basic portal
Order creation. It does not implement multi-invoice payment or the broader
portal workspace.

**Disposition: PASS WITH FINDINGS — deployable, not live-validated.**

## Commercial authority

- `v2_customer_product_entitlements` is tenant, Customer, and Product scoped.
  The scoped catalog and the Sales transaction both enforce it for portal
  Orders; direct Product IDs cannot bypass the check.
- `v2_customer_product_pricing_agreements` is ProductVersion-aware. A
  version-specific active agreement wins over a product-wide active agreement;
  otherwise standard canonical Product pricing applies. A staff-authorized
  explicit Order override remains the final existing Sales authority.
- Agreements are immediate-only in this milestone. Their effective time is
  database-owned and each replaced record remains historical/auditable. There
  is deliberately no misleading future scheduling or expiry contract.
- Staff commercial authoring is capability gated (`product.edit` for
  entitlements, `pricing.configure` for agreements). Commercial events retain
  the actual staff actor, including delegated-AI attribution.

## Canonical Sales integration and freezing

`OrderApplicationService` uses a customer-aware pricing port inside the same
PostgreSQL transaction. Portal, staff, inbound, service, and future AI Order
creation therefore resolve the same agreement evidence. Portal requests
enforce catalog entitlement; staff/inbound/service requests may price a known
Customer without making every staff Order depend on portal catalog membership.

Sales persists the resulting `PricingResult`, including applied agreement
evidence, in the existing frozen Order line snapshot. Subsequent Product price,
agreement, or entitlement changes affect future Orders only; they do not
reprice existing Orders. Quote conversion continues to use its existing frozen
commercial snapshot rather than recalculating it.

## Portal ordering and security

- `POST /v2/portal/orders` derives organization, Customer, and Contact from
  the signed portal session and a fresh active portal-access/contact/link
  lookup. Request-supplied ownership IDs and price overrides are ignored.
- The endpoint delegates to canonical Sales; it does not write Order tables
  directly. Orders therefore enter normal staff workspaces and normal workflow
  policy immediately.
- The `customer_full_portal` template receives only the deliberate
  `order.create` addition. `customer_view_only` remains unable to create
  Orders. The organization portal ceiling makes that already-assigned
  capability usable without granting it to unassigned or view-only portals.
- Mutations require the existing session CSRF token. Return paths are an exact
  allowlist; catalog, Orders, and Quotes additions do not permit external,
  backslash, query, or fragment redirects.
- The small portal catalog surfaces only enabled entitled Products and invokes
  server-owned price preview and creation endpoints. It exposes no Product
  formulas, matrices, costs, margins, or routing internals.

## Artwork boundary

Portal-created Orders have the canonical Order/line correlation needed for
Artwork. Binary customer-artwork upload is intentionally not enabled here:
the existing canonical `ArtworkUploadService` storage ledger, adoption,
assignment lineage, and audit workflow must be wrapped by a portal-scoped
upload endpoint that verifies the authenticated Customer owns the target Order
and line, records `customer_upload`/`customer_supplied`, and never promotes it
to production-ready art. That bounded upload/adoption wrapper is remaining
M7.5I-B work; no alternate portal file store was created.

## Explicit deferrals

- **M7.5I-B:** full Orders/Quotes/Documents/Proofs workspace, complete Product
  configuration presentation, and the portal artwork upload wrapper.
- **M7.5I-C:** one PaymentIntent/payment with explicit multi-invoice
  allocations. The current single-invoice Stripe path was not altered.
- Authenticated DEV and provider validation remain required. No production or
  provider mutation was performed.
