# M7.6A — AI assistant safe-tool architecture

## Disposition

**PASS WITH FINDINGS — deployable foundation, not a chat product.** M7.6B owns the streaming/operator UI and broader tool coverage.

## Trust boundary

The V2 AI module is split into conversation evidence, a typed tool registry, command preparation, the durable GO gate, canonical-service adapters, and immutable tool audit. The model receives neither database clients nor provider credentials. Organization, staff actor, capabilities, conversation, and GO-time identity are server-derived.

Reads are bounded and capability checked. Commands use `prepare → persistent proposal → literal GO → fresh principal reissue → canonical service → audit`. A business request ID is stable for the pending command; repeated GO cannot reclaim an already-executing/completed record.

## Prior implementation

Legacy assistant code had useful concepts (durable conversations, structured tools, planning and confirmation) but is not reused: it directly used legacy Drizzle data, included Owner-capable and financial/provider operations, retained client-held confirmation state, and had best-effort mutation/audit paths. None is V2 authority.

## Current safe coverage

Read adapters cover customers, products, quotes, orders, artwork, proofs, prepress, production, fulfillment, invoices, payment/refund history, inbound, and canonical pricing preview. They are ports for existing V2 readers and return only bounded safe summaries.

Command adapters cover customer/contact creation, canonical order creation/header/note work, and permitted workflow preparation. They are ports for canonical V2 operations; no adapter may use a raw repository or HTTP route. Finance and providers remain read-only/unsupported.

## Permanent denials

Organization deletion/ownership/teardown, infrastructure, arbitrary SQL, secrets, audit disablement, direct Stripe/QuickBooks/Gmail, charge, and refund are denied server-side even with GO. The tool registry rejects their registration.

## Provider boundary

The system policy is provider-neutral. A future provider may plan against the typed registry, but tools remain authoritative and provider credentials never enter tool/model context.
