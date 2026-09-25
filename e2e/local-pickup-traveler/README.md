# Pickup Traveler lifecycle validation

Run `node e2e/local-pickup-traveler/server.mjs`, then open:

`http://127.0.0.1:4180/fulfillment/orders/fixture-20538`

This mounts the actual Fulfillment workspace, print dialog, history, and thermal
Traveler. API responses and mutations exist only in server memory. There is no
application database connection or physical print submission. Restarting the
fixture clears its state. The fixture uses the shared canonical quantity,
reversal, progress-snapshot, and box-validation helpers.

Static thermal examples use:
`/orders/fixture-20538/traveler?directPrintJobId=none`

Other example IDs: `one`, `two`, `completed`, `reversed`, `multi` (also the prior
`full`, `first`, `second`, `final` examples). `latest` displays the most recently
queued in-memory document. All Order 20538-style data is synthetic.

## Evidence collected September 25, 2026

Chrome local workflow:

1. Entered all 500 Coroplast pieces; printed Box 1 of 2.
2. The saved preparation appeared, selected for the pending pickup.
3. Complete Pickup changed live totals to 500 picked up / 0 remaining.
4. Pickup History retained Reprint Traveler, including Box 1 of 2.
5. Reprint retained previous 0, this 500, after 500/500, remaining 0.
6. Reversed the pickup using the existing reason and acknowledgment controls.
7. History retained the original 500-piece event with Reversed, timestamp,
   staff, and reason. Live totals returned to 0 picked up / 500 remaining.
8. Historical reprint displayed REVERSED, original quantities and Box 1 of 2.
9. Prepared a new 150-piece pickup with blank boxes after reversal; it showed
   previous 0, this 150, after 150/500, remaining 350, and no Box line.

Inspected the actual 80 mm template for omitted boxes, 1 of 1, 2 of 3,
completion, reversal, and multiple lines. Quantity text remains 16 px. The QR,
order/job/customer/contact, product, size and material remain present. The
pickup disclaimer is gone. Omitted box labels leave no reserved gap. No
horizontal clipping was observed. These are browser-rendered checks, not
printer-driver pagination, physical printing, DEV, MAIN, or database evidence.

## Durable behavior

New print preparations save optional manual box labels, canonical per-line
progress, and document details in existing direct-print job JSON. Each new job
prints one supplied label; omitted values produce no Box line. Legacy saved
batches retain their original box sequence when reprinted.

Staff explicitly selects which preparations belong to Complete Pickup; newly
queued paperwork is selected automatically. The existing completion transaction
locks and validates those jobs against the exact handoff quantities, then adds
only a handoff ID to their JSON. It does not rewrite any snapshot. Selection
survives as the durable association; after a page reload, pending preparations
can be selected again. No matching by event order, date, or similar quantities.

When no preparation is selected, Complete Pickup saves its pre-handoff document
and progress, with no box label, in the existing PICKUP_HANDOFF_RECORDED event
JSON. The completed event therefore has a Print Traveler action even if nothing
was printed beforehand. Reprints use this same canonical print endpoint.

Reversal display reads canonical append-only events. Live fulfillment quantities
remain under the unchanged canonical reversal/projection engine. The thermal
status is read separately from the saved quantity/document snapshot; a reprint
queued before an association was recorded resolves its original document's
current association before rendering. Partial reversal is distinguished from
full reversal. Printing changes only print jobs, not physical fulfillment.

Historical jobs without associations are available separately. Historical
handoffs without a saved snapshot cannot be reconstructed safely and show that
no saved Traveler is associated. Older print jobs without a document-detail
snapshot retain their existing metadata behavior; new snapshots preserve line
and order details. No schema migration or historical-data backfill is included.
