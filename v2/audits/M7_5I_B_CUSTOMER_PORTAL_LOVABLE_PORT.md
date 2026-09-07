# M7.5I-B — Customer Portal Lovable presentation port

## Authority and scope

`reference/lovable-ui` is the current Lovable presentation authority (the
`PrintFlow Command (7).zip` export recorded in its `REFERENCE.md`).  This
milestone ports its customer portal information architecture, hierarchy,
responsive shell, and customer-facing interactions into the active V2 UI. It
does not import the export's TanStack Start runtime, mock store, fixture data,
local pricing functions, local payment state, or Supabase access.

V2 remains authoritative for authentication, customer scope, commercial
entitlements and pricing, Sales, Artwork, proofs, fulfillment, finance, and
Stripe.

## Ported portal surface

- A responsive customer shell exposes Home, Orders, Shop, Quotes, Proofs,
  Invoices, and Account, with compact navigation for smaller screens.
- Home uses bounded customer-scoped Orders, proofs, and invoice projections;
  the Orders aggregate is server-derived and tenant/customer scoped.
- Orders support current/history presentation and bounded search, customer-safe
  detail, per-line fulfillment remaining quantity, and only the caller's
  shipment/tracking facts. Combined shipment contents belonging to other
  customers are never returned.
- Quotes expose lists, totals, details, and a converted-Order indication.
  Portal quote acceptance and quote-document download are not represented as
  working controls because canonical portal contracts do not exist yet.
- Proofs retain exact immutable artifacts, revision history, approval, and
  change-request comments through the existing canonical proof routes.
- Shop only loads entitled Products and obtains all prices from canonical
  server-side preview and Order creation endpoints. It deliberately presents
  only supported quantity/dimension inputs; unsupported option/choice contracts
  remain a backend/product-contract follow-up rather than local UI logic.
- Invoice detail retains the existing one-invoice Stripe PaymentIntent flow,
  document PDF link, balance and payment history. Selecting more than one
  invoice shows an explicit unavailable notice; it makes no payment call.
- Account presents only session-backed account information and password-reset
  navigation. It has no fabricated profile editing.

## Artwork adoption

`POST /v2/portal/orders/:orderId/lines/:orderLineId/artwork` is a dedicated,
CSRF-protected portal boundary. It accepts a bounded PDF customer-source upload
only after verifying the signed-in portal user owns the specified open Order
line. The binary is written and adopted through the canonical Artwork storage,
idempotency, lineage, and audit path. It cannot create production Artwork,
replace prior assignments, use layered uploads, or cross customer/tenant
scope. Order detail offers the corresponding customer-source PDF action.

## Read-model and safety changes

The customer commercial read boundary now has opaque cursor paging for Orders
and Quotes, a bounded Orders dashboard projection, and customer-safe
fulfillment quantities/shipment timestamps. All predicates derive organization
and customer from the authenticated portal principal. Portal return targets are
allowlisted for the new customer routes.

## Intentional deferrals

- **M7.5I-C:** a payment aggregate of one PaymentIntent/Payment allocated to
  multiple invoices. The UI does not emulate this with multiple charges.
- Canonical portal quote acceptance, quote/order document download, portal
  profile editing, and richer product option/choice/fulfillment configuration
  need their own customer-safe contracts before their presentation controls can
  be activated.
- No provider configuration, production deployment, or production provider
  write occurred.

## Disposition

**PASS WITH FINDINGS — deployable, not live-validated.** The approved Lovable
presentation is now implemented against V2 authority for the launch-supported
surface. P1 follow-up remains for the intentionally unavailable customer
contracts above; multi-invoice payment is deliberately owned by M7.5I-C.
