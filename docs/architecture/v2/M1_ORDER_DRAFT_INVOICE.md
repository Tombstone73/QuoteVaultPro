# M1.9 — Order + Draft Invoice

M1.9 is the first direct writable V2 Order slice. It is deliberately not Quote
conversion, payment, tax implementation, or production execution.

## Ownership and transaction boundary

Sales owns the current Order, its lines, selling-price decisions, revision,
lifecycle, and number. Billing owns the distinct Draft Invoice projection,
invoice lines, totals, and future financial lifecycle. Routing owns the frozen
Route Instance and steps. Pricing remains the owner of calculated price and CRM
and Products remain referenced read models.

`sales.order.create.v1` is coordinated inside one caller-owned PostgreSQL
transaction through explicit ports:

```
Sales Order + lines -> Billing.createDraftInvoice -> Routing.instantiateRoute -> Audit/outbox -> commit
```

The coordinator never writes Billing or Routing tables itself. M0 operation
request reservation makes the complete result principal-neutral and idempotent.
Any failure rolls all participants back.

## Direct Order behavior

A direct Order validates organization-scoped customer/contact and active Product
configuration, calculates a Pricing result, preserves the Sales-owned selling
decision, allocates an `ORD-*` number, and creates exactly one Billing Draft
Invoice. A Product Type policy is explicit: `route_required` instantiates its
default template, `no_route` does not, and `unconfigured` rejects the operation.
Routes reference physical V2 Order-line identity only after that line exists.

Order commercial edits use optimistic revision and an explicit
`Billing.synchronizeDraftInvoice` operation while the invoice is Draft. Sales
does not update Invoice rows. An Issued or void Invoice rejects silent sync.
Route-changing edits are conservatively rejected; M1.9 does not auto-rebuild
route history.

Supported edits are quantity, explicit configuration/dimensions with server
resolution and repricing, add line, removal of a line that has no Route
Instance, and authorized unit/total selling-price decisions. Existing routed
lines retain their Sales line and Route identities. Product/Product Type
retargeting and routed-line removal require a future explicit Routing
operation and therefore fail closed in M1.9. When a Product definition has
changed, ordinary repricing cannot silently adopt new defaults; adoption must
be explicit through configuration input.
Quantity/configuration edits also preserve the Sales-owned line description
unless the command explicitly replaces it. Typed Order reads expose safe
integer calculated/selling aggregates plus a Billing-sourced Draft Invoice
summary; the summary is composed through `BillingReadPort`, not by reading
Billing persistence from Sales.

## Persistence integrity

The M1.9 migration creates Billing-owned `v2_billing_invoices` and
`v2_billing_invoice_lines`. Tenant-scoped foreign keys bind an Invoice to its
Order and each Invoice line to its source Order line. A partial unique index
enforces one Draft Invoice per Order. Routing now has tenant-scoped physical FKs
to the Order header and line. Money remains integer cents. The temporary tax
projection is named `m1.9-zero-tax-compatibility`; Pricing/PBV2 does not own tax.

## Authority and HTTP

The authenticated V2 runtime derives a fresh Principal from trusted session,
membership, and Permission Sets. It accepts no client Principal, staff ID, or
capability. Required capabilities are `order.view`, `order.create`,
`order.edit`, and the narrow `order.overridePrice`. All mutations require the
existing session-bound CSRF and M0 business-request identity.

Billing exposes a tenant-scoped `BillingReadPort` and one authenticated safe
read endpoint at `GET /v2/organizations/:organizationId/invoices/:invoiceId`.
The projection contains intentional Invoice facts and source Order-line
references, never raw Billing rows. `invoice.view` is evaluated against fresh
permission-set authority and the Invoice customer scope.

The override capability is added to the template catalog for future
permission sets. Migration 0196 removes the transient 0195 backfill from
already-existing source-template-derived sets because template provenance is
not continuing authority and organization customization must be preserved.

## Executed PostgreSQL proof

The guarded M1.9 rehearsal creates Orders only through the real application
operation and proves mixed printed/static/service routing, exactly one Draft
Invoice, quantity/configuration/add/remove/override synchronization, stale and
concurrent edit coherence, principal-neutral replay, distinct concurrent
numbering, tenant isolation, authenticated Billing read, non-Draft rollback,
and injected rollback after Sales, Billing, Routing, and Audit. M1.7 Quote and
M1.8 Routing rehearsals remain required regressions.

## Deliberate exclusions

No Quote-to-Order conversion, payment, refund, Invoice issuing UI, Production,
Artwork, fulfillment, or route mutation is introduced here. M1.10 will define
conversion using a qualifying Quote checkpoint without repricing it.

## Next milestone

**M1.10 — Quote → Order Conversion**. It must consume the immutable Quote
checkpoint and invoke the same Sales/Billing/Routing orchestration without
silently recalculating commercial history.
