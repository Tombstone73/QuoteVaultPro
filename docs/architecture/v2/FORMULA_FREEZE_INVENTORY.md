# Formula freeze inventory — blocked

Date: 2026-08-22

## Outcome

The requested DEV read-only inventory was **not run**. No explicitly
authorized `FORMULA_FREEZE_INVENTORY_DATABASE_URL` was available. The only
discovered database setting was `TEST_DATABASE_URL`, whose parsed target was
`ep-summer-glade-aeyqazl0-pooler.c-2.us-east-2.aws.neon.tech/neondb`; it is
neither an explicitly authorized DEV inventory connection nor a safely named
test target. It was not used.

The planner correctly refuses fallback database configuration. Its invocation
with a tenant placeholder stopped before connecting with:

`FORMULA_FREEZE_INVENTORY_DATABASE_URL is required; this tool will not fall back to an application database URL.`

## Required repair before an inventory run

The current read-only script does not print or verify host, database name,
schema, and environment identity before `BEGIN READ ONLY`, as the runbook
requires. It also omits `product_name` from the emitted plan even though the
query selects it, and it treats legacy variable values as if they were typed
input declarations. Those gaps prevent a compliant product-by-product
canonicalization plan.

Do not supply a connection or run a backfill until the planner can:

1. print a redacted, positively verified DEV target identity before connecting;
2. report Product name, ProductVersion, exact provenance, and source fields;
3. distinguish proven declared-input contracts from variable values; and
4. retain its existing `BEGIN READ ONLY` / rollback-only behavior.

## Static compatibility evidence only

This is not inventory output and must not be used as a migration map.

| Product / ProductVersion | Earlier evidence | Current disposition |
| --- | --- | --- |
| Coroplast / `4de9ac11-7f9e-4a0c-a29f-b690c3992e66` | Published typed sheet Formula with option-controlled rotation and known parity vectors. | Binding state unknown without DEV inventory. |
| Concept 204 Low Tac | Earlier readiness audit identified legacy Product Formula provenance. | Requires live provenance and input evidence. |
| Posters | Earlier readiness audit identified legacy Product Formula provenance. | Requires live provenance and input evidence. |
| Substance 2755 Sign Vinyl | Earlier readiness audit identified legacy Product Formula provenance. | Requires live provenance and input evidence. |
| Window Perf | Earlier readiness audit identified legacy Product Formula provenance. | Requires live provenance and input evidence. |

Formula source precedence for the future inventory is:

`FormulaRevision binding → legacy Formula Library pointer → embedded ProductVersion expression → products.pricing_formula`.

A shared immutable Formula identity/revision is safe only when exact resolved
expression, Formula profile/semantics, declared-input contract, and bound input
values are all proven identical. Names and similar-looking text are not enough.

## Formula API readiness (static review)

The V2 API exposes tenant-scoped Formula list, detail, revisions, usage,
declared inputs, visibility, and status in the standard `{ ok, data }` envelope.
It is sufficient for the planned Formula Library UI foundation. Before UI work,
address these contract gaps:

1. revisions and usage should return `404` for an unknown/foreign Formula,
   rather than `200 []`;
2. the client list transport should expose the backend's `includeInactive`
   filter; and
3. the client revision projection should retain validation evidence and creation
   metadata for audit presentation.

## No mutations

No database connection, Formula/Product/ProductVersion write, backfill,
publication, or Product configuration change occurred.
