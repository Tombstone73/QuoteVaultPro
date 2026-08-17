# M4 Interface Convergence Closure

## Decision

**M4 COMPLETE / READY FOR M5.** Major M0--M3 staff workspaces are routed real-data adapters. The Command Center is read/navigation-only and composes bounded Sales quote/order lists plus the Billing finance overview; it stores no dashboard state and suppresses cards without their source read capability.

## Route map

`/`, `/products`, `/products/:productId`, `/customers`, `/customers/:customerId`, `/artwork`, `/proofing`, `/prepress`, `/quotes`, `/quotes/:quoteId`, `/orders`, `/orders/:orderId`, `/invoices`, `/invoices/:invoiceId`, `/payments`, `/fulfillment`, `/fulfillment/orders/:orderId`, `/production`, `/production/flatbed`, `/production/roll`, `/routing`, and `/appearance` are real V2 destinations.

## Deferred beyond M4

Inbound final submission, Portal/Storefront, and AI Plan/GO remain **DOMAIN CAPABILITY REQUIRED**. Delivery/Communications, carriers, Inventory/Procurement/Nesting, server-synced preferences, provider UI, Invoice Void/PDF/corrections, QuickBooks, and mobile hardening remain deferred.

## Evidence and next milestone

The shell exposes only routed workspace navigation; appearance remains browser-local and now exposes all existing model controls. Static type, route, appearance, routing, fulfillment, build, and import-boundary checks pass. Clone/browser/DEV/MAIN validation remains outstanding without authorized PostgreSQL/browser fixtures. The master plan defines **M5 Shadow/parity** as the next milestone.
