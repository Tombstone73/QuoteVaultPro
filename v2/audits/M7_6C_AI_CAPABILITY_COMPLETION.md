# M7.6C — AI capability completion

## Scope

M7.6C extends the existing V2 assistant tool plane. It does not introduce a database client, a provider write path, a generic mutation endpoint, or a second authority model.

## Live reads

The runtime now composes bounded, tenant-scoped summaries from canonical services for Artwork, Proofs, Prepress, Production, Fulfillment, Inbound, Finance, Customer activity, and customer/Product pricing. Existing Customer, Product, Quote, and Order reads remain intact.

Every read receives the server-issued staff principal and organization from the conversation context. The registry checks the tool capability before execution; application services repeat their own authorization and tenant checks. Results are compact cards only: no Artwork object keys/checksums/binary data, proof recipient email/comments, inbound raw bodies, or internal audit records are sent to the model.

Pricing is a separate typed tool, not a reinterpretation of generic search. It requires exact customer, Product, and bounded quantity/configuration input, resolves the active canonical Product pricing input, applies the canonical customer-commercial adapter with the `ai` channel, and returns only the calculated currency/line amount plus whether a customer agreement applied. It does not expose formulas, matrices, cost, or margin.

## Entity and context discipline

The model cannot supply organization, staff identity, or a direct database query. IDs in tool input are opaque canonical references. Ambiguous cross-domain work must first be resolved through Customer/Order/Product reads; Customer activity requires an exact resolved customer ID. The assistant does not infer a station, Product, customer, quantity, or routing destination from prose. Canonical services re-read current state at execution time.

## GO commands

`order.production_not_required` remains live with exact GO confirmation.

M7.6C adds `inbound.mark_duplicate`. Preparation reads the exact current intake and permits only terminal-eligible states; GO delegates only `inbound.review`, invokes the canonical idempotent terminal transition with the durable assistant business request ID, and records the reason/audit trail.

The following were audited but intentionally remain unavailable: inbound conversion (requires both `inbound.review` and `order.create`, while the current GO delegation grants one capability), customer creation, contact creation, order creation/header/note changes, proof delivery, fulfillment handoffs, production output, shipment-container actions, and all destructive work. No proposal can execute merely because a model asks for it.

## Permanent denials

Finance/payment/refund/Stripe/QuickBooks writes, Gmail/provider calls, secrets, infrastructure, arbitrary SQL, database mutation, ownership changes, and audit disablement remain hard-denied. The assistant has no direct provider or database mutation capability.

## Result presentation and safety

Tool results remain stored as bounded structured tool messages and rendered as compact UI cards through the existing Assistant workspace; they are not exposed through a generic client tool endpoint. The provider policy treats returned business content as untrusted data. Existing per-user/per-organization turn limits, bounded tool loop limit, exact `GO`/`CANCEL`, pending-command expiry, fresh GO-time identity/capability revalidation, audit events, and connection ownership remain unchanged.

## Tests

`aiSafeToolPlane.test.ts` covers server-issued read context, typed pricing preview input, exact GO/CANCEL behavior, the new inbound duplicate command, no pre-GO mutation, duplicate GO rejection, tool-loop bounding, provider failure, and prompt-injection policy text.
