# M1.10 — Quote → Order Conversion

## Boundary

Conversion is a Sales operation (`sales.quote.convert.v1`) authorized by
`quote.convert`.  It is neither a Quote deletion nor a new Product/Pricing
calculation.  A Quote remains readable with its Sent, Accepted, and Converted
checkpoints after the new Order is created.

Only a Quote that is both sent and accepted may convert.  M1.10 treats an
accepted Quote as a commercial source boundary: normal Quote edits are refused
thereafter.  The caller supplies the immutable `quote_accepted` checkpoint
identity, an optimistic Quote revision, and a principal-neutral business
request identity.

## Atomic choreography

One PostgreSQL transaction coordinates module contracts:

1. reserve the Quote conversion operation request and lock the Quote;
2. verify scope, `quote.convert`, accepted state, revision, and source
   checkpoint;
3. clone accepted commercial lines with new Order-line identities, preserving
   configuration, PricingResult, and SellingPriceDecision without repricing;
4. use the canonical Order creation core to create the Order, Billing Draft
   Invoice, and Routing route instances;
5. append a `quote_converted` checkpoint and immutable Quote→Order lineage;
6. record truthful Quote and Order audit events plus Quote operation
   attribution, then mark the operation request successful.

The coordinator never writes Billing or Routing tables directly.  It invokes
their transaction-scoped contracts through the canonical Order core.

## Historical integrity

The accepted checkpoint is the source of commercial truth: its terms, lines,
resolved configurations, pricing evidence, and selling decisions survive
unchanged in the Order.  New line IDs are the sole copied-value change, because
Sales line identity is document-local persistence identity.  Current PBV2
defaults, formulas, prices, and Product display data are not consulted.

The existing physical model provides unique Quote conversion lineage, one
Converted checkpoint per Quote, tenant foreign keys, append-only conversion and
checkpoint rows, and deferred reciprocal lineage/checkpoint validation.  M1.10
adds no migration.

## Post-conversion behavior

The lineage is included in Quote and Order read models.  A converted Quote
cannot be edited or transitioned.  Later Order commercial edits synchronize
the Draft Invoice through Billing and do not rewrite Quote checkpoint or
lineage history.

## Validation scope

The clone rehearsal must prove happy-path conversion, M0 replay and
same-Quote races, edit-versus-convert locking, full rollback at Sales/Billing/
Routing/checkpoint/lineage/audit seams, tenant denial, frozen pricing, current
route policy behavior, authenticated CSRF HTTP conversion, and physical
postconditions.  It is intentionally separate from M1.11 Order UI work.

## Next milestone

After clone validation passes: **M1.11 — Unified Sales Workspace**.
