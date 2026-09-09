# M7.7E-B — dedicated QA mutation validation

## Scope and safety

Validation used only the DEV organization `PrintersHero M7 QA` (`b6f969b2-dda3-4133-9d75-c417dabb8f3a`). Its dedicated staff session resolved that exact organization before each mutation. No ordinary DEV tenant, MAIN, PROD, live Stripe, QuickBooks, Gmail, or carrier provider was used.

## Completed evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Product Builder | PASS WITH FIXES | A QA `service_fee` Product was saved, published, reloaded, and listed as `Flat fee`. Two production-safe source defects were fixed: the canonical formula-variable flat fee was rejected at publication, and the workspace summary did not project its configured pricing. |
| Order/workflow | PASS (bounded) | Canonical staff Orders were created for service-fee and fulfillment-only Products. The service-fee Order recorded $2.50 commercial value without route, Production, or Fulfillment work. |
| Fulfillment | PASS WITH FIX | One fulfillment-only QA line of 100 was handed off as pickup 40, shipment 35, pickup 25. Remaining quantity reached zero only after the final event. The manual shipment retained carrier, service, tracking, package count, and immutable handoff history. An over-allocation was rejected. |
| Finance/refunds | PASS (manual/provider-free) | A $40 QA manual check payment and $10 refund were entered through the staff UI. Financial history retained separate immutable facts and derived balance changed from $100 to $60 then $70. |
| Authorization | PASS (bounded) | Mutation requests without CSRF were rejected; authenticated QA session was scoped to the dedicated organization. |
| Retry safety | PASS WITH FIX | Existing fulfillment handoff retry left quantities unchanged. Shipment-container create/ship request IDs were previously ignored; `1ab063d2` now reserves and replays durable operation requests. Focused test proves same-payload replay and changed-payload conflict. |

## Not yet exercised in this bounded run

Formula/matrix Products, Flatbed/Roll mapped jobs, proof revision lifecycle, Prepress handoff, canonical inbound fixture conversion, Portal user flows, multi-invoice aggregate payment/refund, and live AI turn/GO remain unexecuted. Their absence is a validation finding, not a claim of failure or completion. Stripe TEST/provider validation remains pending because this isolated tenant has no provider integrations.

## Current disposition

**PARTIAL PASS — NOT CUTOVER EVIDENCE.** The QA tenant and completed mutations prove isolation and several critical write paths; the remaining explicitly listed workflow matrix must be run before M7 operational validation can be called complete.
