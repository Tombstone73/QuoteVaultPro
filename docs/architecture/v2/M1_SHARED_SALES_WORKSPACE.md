# M1.11 — Shared Sales Workspace / UI Evidence

M1.11 presents the proven V2 commercial spine as one Staff-facing Sales area:

`Quotes → Send → Accept → Convert → Order → Draft Invoice → Routing identity`

It reuses the M1.7.5 Vite application, authenticated session, CSRF, React Query
namespace, semantic themes, Customer/Contact/Product reads, and server-driven
Product configuration editor. It creates no alternative UI foundation or client
commercial calculation.

## Workspace shape

The Sales navigation contains only **Quotes** and **Orders**. Both use compact,
tenant-scoped list projections with deterministic updated-at ordering, bounded
cursor pagination, number/Customer lookup, and lifecycle filters. Lists expose
summary facts only; they do not return line graphs or raw persistence rows.

Quote and Order screens share small commercial pieces where the concept is
actually common: lifecycle badges, calculated/selling money presentation,
Product configuration editing, server-driven dimensions/quantity behavior,
stale-state treatment, and commercial totals. They deliberately do not use a
generic document engine: Quote lifecycle/history and Order Billing/Routing
context remain document-specific.

## Ownership at the UI boundary

- Sales owns Quote and Order current commercial state. The browser submits
  commands and displays the authoritative response.
- Pricing remains server-side. React formats returned cents but never computes
  pricing, selling totals, or Invoice totals.
- Billing owns the Draft Invoice. Sales displays its typed read summary and
  optional read-only detail; it never queries Billing tables from the UI or
  simulates synchronization.
- Routing owns route state. Sales displays read-only line-scoped frozen route
  summaries and offers no progression, reroute, or cancellation control.
- Existing routed Order lines retain Product/Product Type identity. A routed
  line has no misleading remove action; only a no-route line can be removed by
  the established M1.9 operation.

## Quote conversion

An Accepted Quote exposes a confirmation-backed `Convert to Order` action only
when the server-derived `quote.convert` capability is present. The browser sends
the accepted checkpoint identity and current revision to M1.10, then refetches
the Quote and opens the returned Order. A converted Quote remains a Quote and
shows its Order relationship; its historical lifecycle checkpoints remain a
compact read-only timeline.

## Document-specific workspace behavior

The Quote workspace keeps the established Create/Edit, Send, Accept, and
Convert actions explicit. Lifecycle action availability is a server-derived
fact; the browser does not recreate a lifecycle state machine. After
conversion, commercial controls are unavailable, the Quote stays separately
readable, and its historical link to the resulting Order is displayed rather
than replacing the Quote with an Order page.

The Order workspace intentionally reuses the same Customer/Contact fields,
line editor, Product configuration projection, dimensions, quantity fields,
calculated-versus-selling display, totals, and stale-state treatment. Its own
context remains explicit: it shows the Billing-owned Draft Invoice summary,
read-only Routing summaries per line, and the M1.9 restriction that a routed
line cannot be removed by Sales. A no-route line uses the existing Sales
operation and may be removed.

## Read projections and capability UX

List reads are bounded cursor pages (default 25, maximum 50), ordered by
`updatedAt DESC, id DESC`. A cursor is an opaque continuation token. Practical
number/Customer text lookup and lifecycle filtering stay inside the tenant
scope; neither list endpoint exposes raw persistence graphs or attempts global
search. The interface exposes first/next-page controls and resets a cursor
when its organization or filter changes.

Pricing and SellingPriceDecision are distinct in both workspaces. React only
formats returned money; it does not derive a line, document, or Invoice total.
An existing override stays visible to a limited user, but its editor is
available only from the server-derived `quote.overridePrice` or
`order.overridePrice` projection. The server remains the authority when a
capability changes between display and mutation.

The invoice summary is read through Billing's typed HTTP boundary and reports
the Draft identity, lifecycle, line count, and returned total. Routing is read
through its typed projection and reports a route's frozen steps/current step;
Sales does not infer route state from Order state and has no routing controls.

## Safety and authority

All query keys include opaque session scope and organization. Session changes
clear V2 query state. Capability projection is presentation-only; every API
operation freshly issues a Principal and enforces Permission Sets server-side.
CSRF and M0 business-request identities remain distinct.

`STALE_STATE` causes an authoritative refetch and a concise operator notice;
there is no blind retry. Product-definition changes keep persisted commercial
configuration visible until an operator explicitly adopts a current definition.

## Themes and authenticated browser evidence

The same JSX and semantic UI components run under the PrintersHero, Corporate,
and Industrial themes. Theme selection does not branch commercial behavior.
The authenticated Playwright composition exercises a trusted Passport session,
fresh Principal issuance, Permission Sets, session-bound CSRF, M0 operation
coordination, real Sales/Billing/Routing APIs, and the authorized disposable
PostgreSQL clone. Browser cases cover list scope, quote lifecycle/conversion,
Order edits and stale writes, invoice synchronization, routing stability,
authority failures, and session/organization React Query isolation.

## Explicitly deferred scope

M1.11 does not add Invoice editing or issuance, payment/refund behavior,
Routing progression or cancellation, Product/CRM administration, global
search, Artwork, Prepress, Production, Inventory, Fulfillment, Shipping, or a
new UI/theme/authentication foundation. Those remain later bounded work.

## Validation target

The clone-backed browser harness extends the M1.7.5 authenticated host with
Order and Billing composition. It verifies real browser Quote conversion,
resulting Order editing, Draft Invoice synchronization, line-scoped Routing,
no-route removal, routed-line protection, authoritative readback, and the same
workspace under PrintersHero, Corporate, and Industrial themes.

## Next milestone

M1 is complete only after the M1.11 browser/clone evidence gate passes. The
next reconstruction work after that gate is M2; this document does not begin it.
