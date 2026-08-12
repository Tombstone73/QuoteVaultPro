# AI Operator authority divergence (Phase 2A)

Generated from the Phase 1 inventory and exact extractions of the current chat and execution route grant maps. This is developer-only shadow evidence, not runtime enforcement.

## Trusted authority sources

- Authentication: authenticated request identity (`claims.sub` or `id`).
- Tenant and organization role: `tenantContext`, backed by the tenant membership record.
- Current role-to-grant mapping: chat `buildActor`; Phase 2A wraps this as a legacy adapter only.
- Execution scope is synthetic and is explicitly not accepted as a resolver authority source.

## Known grant divergence

- Member chat grants: 3; member execution synthetic grants: 28; execution-only: 25.
- Admin chat grants: 8; admin execution synthetic grants: 37; execution-only: 31.
- Commands with known permission metadata outside member chat grants: 29.
- Commands with known permission metadata outside admin chat grants: 26.

## Execution-only permissions for a member

- `assistant.quotes.create_draft`
- `assistant.quotes.update_draft`
- `assistant.orders.create`
- `assistant.orders.update_editable`
- `assistant.quotes.convert_to_order`
- `assistant.customers.create`
- `assistant.customers.update_profile`
- `assistant.customers.update_commercial_terms`
- `assistant.contacts.create`
- `assistant.contacts.update`
- `assistant.production.intake_line_items`
- `assistant.production.send_to_prepress`
- `assistant.production.update_job_status`
- `assistant.production.add_job_note`
- `assistant.fulfillment.create_shipment`
- `assistant.fulfillment.update_shipment_details`
- `assistant.fulfillment.mark_shipped`
- `assistant.fulfillment.create_pickup_ticket`
- `assistant.fulfillment.add_note`
- `assistant.billing.create_invoice`
- `assistant.billing.update_invoice_draft`
- `assistant.billing.send_invoice`
- `assistant.billing.add_invoice_note`
- `assistant.payments.record_manual_payment`
- `assistant.payments.add_payment_note`

## Unresolvable command permission metadata

- `products.create_inactive_draft_batch` (missing from descriptive command-permission mirror)
- `products.adjust_pricing` (missing from descriptive command-permission mirror)
- `products.rollback_pricing_change_set` (missing from descriptive command-permission mirror)
- `products.create_configurable_draft` (missing from descriptive command-permission mirror)
- `products.create_from_canonical_intent` (missing from descriptive command-permission mirror)
- `products.clone_to_inactive_draft` (missing from descriptive command-permission mirror)
- `products.replace_inactive_matrix` (missing from descriptive command-permission mirror)
- `products.replace_inactive_quantity_tiers` (missing from descriptive command-permission mirror)

## Known descriptive mirror gaps

- `products.create_inactive_draft_batch`
- `products.adjust_pricing`
- `products.rollback_pricing_change_set`
- `products.create_configurable_draft`
- `products.create_from_canonical_intent`
- `products.clone_to_inactive_draft`
- `products.replace_inactive_matrix`
- `products.replace_inactive_quantity_tiers`

## Deliberate Phase 2B questions

- `super_admin` is not a tenant role mapped by chat authority and resolves UNKNOWN.
- Command `allowedRoles` is metadata, not the current execution gate; compare it before cutover.
- Route families use non-uniform authorization middleware, so normal application authority remains partly unproven.
