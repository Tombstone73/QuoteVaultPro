# V2 quote-to-order conversion evaluation

## Verdict

V2 can preserve the accepted quote commercial snapshot without invoking current catalog pricing. The experiment uses one explicit PostgreSQL transaction and V2-private request/conversion records; it does not import V1 business services or repositories.

## Reconstructed V1 contract

V1 locks the quote, maps active quote lines, preserves stored PBV2/effective price and tax snapshots, reuses file records when projecting quote artwork to the order, creates the draft invoice, and links the quote to the order. `active` is the approved database status; expiry is derived from `valid_until`. A linked contact resolves the order owner to its active linked customer.

## V2 architecture and result

`PostgresQuoteConversionApplication` authorizes an organization role, locks and snapshots quote/line state, resolves customer/contact ownership, writes order, lines, artwork projection, invoice, and durable conversion link in one transaction. It never reprices from `products` or PBV2 during conversion. The source quote remains history and gets its compatible `converted_to_order_id` projection only with the durable link.

The V2-private `v2_poc_quote_conversion_requests` records same-request results; `v2_poc_quote_order_conversions` has a unique `(organization_id, quote_id)` constraint for different concurrent request IDs.

## Runtime evidence

- Quote price and tax snapshots survived a PBV2 tree change.
- Linked contact remained the order contact and its customer remained the owner.
- Quote attachment allocation/group/role projected to the order while retaining the same file record; proof-required lines start `awaiting_proof`.
- Fresh-instance retry returns the same order/invoice.
- Same and different concurrent requests create exactly one conversion.
- Failure injection after every boundary rolls back orders, invoice, artwork projections, link, and request claim; retry succeeds.
- Canceled/expired, foreign-tenant, and unauthorized conversions are rejected.

## Compatibility scorecard

| Area | Rating | Notes |
| --- | --- | --- |
| Quote and lines | GREEN | Locked current tables translated to snapshot. |
| Customer/contact | GREEN | Active link wins over legacy contact ownership. |
| Pricing/tax | GREEN | Stored quote values are authoritative. |
| Artwork/proof | GREEN | File identity and allocation projection preserved; proof requirement carries forward. |
| Order/billing/link | GREEN | One transaction and durable uniqueness. |
| Portal/AI | YELLOW | Both V1 callers already use canonical conversion; adapters are future work, not separate mutation logic. |

V1 is already strong in this workflow. V2 is clearer at the module and transaction boundary rather than materially superior in business behavior. The full-rebuild thesis is **STRONGER** because this adds parity evidence for a complex commercial workflow. Recommended next experiment: UI/Portal/AI adapters calling one shared V2 operation.
