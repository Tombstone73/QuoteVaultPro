# Local Pickup Traveler validation

Run `node e2e/local-pickup-traveler/server.mjs`, then open:

`http://127.0.0.1:4180/orders/fixture-20538/traveler?directPrintJobId=first`

Supported `directPrintJobId` fixtures: `full`, `first`, `second`, `final`, `multi`.
These synthetic GET-only endpoints mount the actual Order Traveler page and use
the shared canonical quantity resolver and Pickup Traveler snapshot builder.
No database, production endpoint, print job, or physical printer is involved.

On September 25, 2026, all five scenarios were inspected in Chrome using the
existing 80 mm thermal template. The Coroplast fixture uses 24.00 x 20.00 and
Coroplast - 4mm, modeled after the reported Order 20538-style label. It is not
live Order 20538 data. Progress text is 16 px; the 80 mm page measured 302.35 CSS
pixels. Quantity blocks had no horizontal overflow. Product, size, material,
QR, and distinct Box 1/2/3 of 3 labels remained present. Multi-line quantities
were 400/500 with 100 remaining and 50/50 with zero remaining on each box.

## Lifecycle and reprints

The Fulfillment workspace queues Pickup Travelers before the separate Complete
Pickup action. The queue route obtains current canonical per-line obligations
and saves the prepared progress in existing `direct_print_jobs.print_context`.
There is no handoff identity on a print job. Thus, rendering must never add a
queued pickup to a later live completed aggregate, which could already include it.

New print preparation uses current canonical ordered, net picked-up, and
remaining quantities. Projected after-pickup count is previous picked-up plus
this pickup; projected remaining is canonical remaining minus this pickup.
Other physical/admin resolution reduces remaining without being called pickup.
Canceled/service/parent lines and production replacement semantics remain under
the existing canonical fulfillment projection.

Re-rendering an existing job retains its prepared quantity snapshot, including
after completion or a later quantity edit. It remains explicitly a preparation
document, not proof of pickup. A new preparation uses current quantities.
Legacy queued jobs without snapshots show their selected quantity and explicitly
unavailable progress: historical pickup identity cannot safely be guessed.
Non-quantity order/line metadata still uses the existing live metadata projection.

This browser inspection does not validate printer-driver pagination, physical
printing, DEV, MAIN, or database-backed request execution.
