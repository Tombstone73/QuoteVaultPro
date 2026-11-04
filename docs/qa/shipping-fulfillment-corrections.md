# Shipping and Fulfillment corrections

## Scope

- Fulfillment and draft shipment allocation groups expose the existing administrative Production Completion Override. The shared preview, reason, bootstrap acknowledgement, conflict resolution, authorization and canonical Order completion operation remain authoritative.
- The shared dialog's production-only mode requires explicit acknowledgement and never invokes historical fulfillment reconciliation. Shipment quantities, dispatch/pickup and financial completion remain separate.
- Customer Orders and portal Orders use the shared tracking component's inline presentation. Multiple packages open in a bounded, keyboard-accessible popover without increasing the table row height. Links still come from the trusted carrier URL builder.
- UPS history exposes permission and saved-response availability flags, not private carrier evidence. Administrators can explicitly recover an uncertain purchase through the existing recovery endpoint, followed by authoritative history readback. This operation does not contact UPS, purchase, void or print.

## UPS investigation and remaining limitation

`LOCAL_PERSISTENCE_UNCERTAIN` is assigned after UPS has returned a usable purchase response and the local transaction has failed. It is not evidence of a failed carrier purchase. The previous catch discarded the underlying persistence exception, so the exact cause of the historical incident cannot be established from that code alone. No live incident records were changed or recovered during this task.

Local persistence now logs only attempt, tenant, shipment, stage, validated SQLSTATE and constraint name. It never logs the raw exception, SQL, label contents or credentials. Expected stale shipment/attempt conflicts return actionable 409 responses.

An active uncertain attempt continues to block another purchase. A complete saved response can be normalized and recorded by the canonical recovery transaction. Missing/invalid saved evidence requires administrator reconciliation against the UPS account/support; this change does not invent carrier confirmation or unlock a replacement purchase. Multi-package recovery retains the existing explicit package-mapping requirement.

## Validation

- Scoped TypeScript, 8192 MB Node heap: 16 changed/new TS/TSX roots, zero diagnostics. Removed an unsupported, unused property from an existing tracking test fixture.
- Focused frontend: 106 distinct passing tests across shared override, recovery, tracking, Customer Orders, Fulfillment workspace/shipment and existing override/void contracts and portal row context.
- Focused server: 67 passing tests covering canonical completion, eligibility, operational completion and UPS accounting.
- Disposable PostgreSQL: 16 passing tests, including five new route/service tests and eleven existing UPS void regressions. Real transactions cover partial shipping, unchanged paid invoices, permissions/tenants, stale prerequisites, concurrent duplicate recovery, exact label bytes/hash readback, uncertain purchase blocking and forced mid-transaction rollback followed by deliberate recovery. UPS credentials/provider context are synthetic; no carrier requests occur.
- Synthetic local browser at normal zoom: light/dark, 1280px and 760px viewports, keyboard disclosure, explicit override/recovery confirmations. Tracking row 37.5px; twenty-package popover capped at 256px with no row growth. Actual components and theme CSS render in Chromium; API persistence is mocked. Database evidence comes from the separate PostgreSQL tests.

No migration, live label purchase/void, print job, production record repair, MAIN push or deployment verification was performed. Physical printer behavior and the exact historical UPS persistence cause remain live acceptance items.
