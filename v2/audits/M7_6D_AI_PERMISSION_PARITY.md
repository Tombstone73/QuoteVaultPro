# M7.6D — AI operational permission parity

## Method

M7.6D compares V2 staff operations with the Assistant’s canonical service path. A live command receives signed-in staff identity at planning time and a fresh, narrowed delegated identity at GO. The delegated identity includes every capability required by the canonical operation; the service then repeats normal authorization, tenant, current-state, request-reservation, and audit checks.

## Canonical hardening

The command protocol now supports several required capabilities. Preparation requires every listed capability; GO revalidates every one and delegates only that set. This is required for Prepress-to-Production (`prepress.complete`, `route.advance`, `production.work`) and prevents a multi-domain operation from becoming a single-capability backdoor.

## Live commands

- `proof.issue`, `proof.retry_delivery`: exact proof version and recipient/delivery state; V2 queues delivery and AI never sends email.
- `prepress.send_to_production`: exact unit; frozen route, proof, Artwork, and destination are revalidated canonically.
- `production.start`, `production.record_output`, `production.complete`: exact work/attempt/station and explicit quantities only.
- `fulfillment.record_pickup`, `fulfillment.record_shipment`: exact immutable allocations and canonical availability checks.
- `finance.record_manual_payment`, `finance.record_manual_refund`: exact cents, currency, Invoice/Payment identity, and occurred time through the immutable V2 ledger, never Stripe/QuickBooks directly.
- `customer.update`, `contact.add`, `contact.update`, `contact.set_primary`: revision-checked CRM administration through the staff service; Customer creation remains excluded pending its separate duplicate-policy seam.
- `artwork.assign_existing`: an existing canonical file can be assigned by exact ID only; AI has no byte, URL, storage-key, or generated-file input.
- `product.create_draft`, `product.abandon_draft`: exact revision-guarded Draft lifecycle only; Product configuration, pricing, routing, and publication remain separate operations.

`order.production_not_required` and `inbound.mark_duplicate` remain live.

## Explicit non-parity findings

Customer creation, shipment containers, commercial agreements, and QuickBooks queue actions are canonical-service/idempotency gaps, not policy denials. Order commands, Direct Production, and safe non-secret settings are remaining adapter gaps.

Customer proof response, delegated authority administration, SQL, secrets, infrastructure/provider control, ownership transfer, audit bypass, and destructive tenant actions remain hard-denied.

## GO and audit

Writes display opaque IDs and exact values. GO is one-time: the pending command is atomically claimed; current identity and every required capability are revalidated; canonical request reservation makes retry replay safe; canonical services record attribution and audit evidence. `CANCEL` does no domain mutation.
