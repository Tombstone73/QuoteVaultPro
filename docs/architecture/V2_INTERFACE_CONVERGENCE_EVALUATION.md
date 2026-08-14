# V2 interface convergence evaluation

## Executive verdict

**V2 ARCHITECTURE MOSTLY PROVEN — ONE MORE EXPERIMENT REQUIRED.**

The adapter boundary is clean: staff UI, reviewed inbound, AI Plan/GO, and a future API can invoke the same typed operation port with no adapter SQL, repository, pricing, tax, fulfillment, invoice, or artwork logic. The experiment deliberately rejects portal authority rather than silently impersonating a staff user.

## Inventory and parity

Existing V2 canonical operations cover order creation, quote conversion, artwork/proofing/prepress, fulfillment, and financial/provider finalization. Quote conversion remains distinct from generic create-order because it must preserve the locked quote snapshot instead of repricing.

| Operation | Staff | AI | Portal | Inbound | Future API | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Create order | SUPPORTED | SUPPORTED after GO | GAP | SUPPORTED after review | SUPPORTED | shared port |
| Quote conversion | SUPPORTED | SUPPORTED after GO | GAP | NOT APPLICABLE | NOT APPLICABLE | staff-only canonical auth |
| Artwork | SUPPORTED | eligible staff action | GAP | NOT APPLICABLE | future policy | staff-only canonical auth |
| Fulfillment | SUPPORTED | eligible staff action | INTENTIONALLY NOT AUTHORIZED | NOT APPLICABLE | future policy | shared operation available |
| Finance | SUPPORTED | eligible staff action | provider-finalization only | NOT APPLICABLE | future policy | shared local financial model |

## Evidence and remaining uncertainty

Current V1 inbound conversion is an independent order/pricing/tax/artwork persistence path; portal quote approval and payment flows also own persistence. V2 avoids that adapter duplication, but existing V2 PostgreSQL applications still hard-code staff membership and generic order idempotency is actor-scoped. The single remaining experiment must introduce a canonical typed authority policy (staff, portal customer, API client, provider) inside application operations, and operation-scoped idempotency where cross-principal retries are a business requirement.

No portal user was elevated to staff; no V1 business services/repositories were reused; no adapter has a DB/repository dependency.

Recommended next task: **CREATE THE PRINTERSHERO V2 RECONSTRUCTION MASTER PLAN** only after the authority-policy/idempotency convergence experiment closes this gap.
