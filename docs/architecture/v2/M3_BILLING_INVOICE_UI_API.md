# M3 Billing Invoice UI / API integration

## Delivered boundary

The authenticated Invoice workspace now lists Billing-owned Invoice records and opens an individual record through the real V2 HTTP API. The view presents the Sales Order business number only as source context; it does not manufacture a customer-facing Invoice number from an UUID or an `INV-` prefix.

`GET /v2/organizations/:organizationId/invoices` is a bounded, tenant-scoped Billing read with optional query and lifecycle filtering. `GET /:invoiceId` returns the authoritative Billing projection. Draft records show their current Billing projection; issued records return the immutable Billing checkpoint and its frozen customer presentation, commercial totals, tax evidence, and line facts. No read path recomputes financial values.

`POST /:invoiceId/issue` requires the existing trusted principal, CSRF protection, `invoice.issue`, and a business request identity. It delegates to the M3 lifecycle operation rather than adding a second issuance implementation. Replay is returned by the existing M0 operation identity, while conflicts and authorization failures are surfaced as normal V2 errors.

## UI truthfulness

The Finance navigation now opens an Invoice workspace in the existing themed V2 shell. It provides draft/issued/void filtering, source Order/customer context, lines, exact totals, PO/terms, and an enabled Issue action only for an authorized Draft. A confirmation explains that issuance freezes the Billing checkpoint and blocks future Sales synchronization.

The Lovable reference contained Payment, Refund, balance, Send, due-date, and invoice-number controls. Those are deliberately not exposed here: M3 has no Payments/Refunds domain, delivery/PDF flow, due-date policy, or canonical human Invoice number. The reference also contains a Void control, but M3 has no canonical void operation; the read-only reserved state is described without providing a functional control.

## Clone validation

The disposable PostgreSQL/browser rehearsal creates a Quote and Order through the UI, opens the generated Draft Invoice, issues it through the real UI/API, replays the same request, and verifies the issued row, one immutable checkpoint, Audit attribution, one operation request, and no Fulfillment handoffs. It also verifies missing CSRF rejection, post-issue Sales edit rejection, limited-principal denial, and cross-tenant concealment.
