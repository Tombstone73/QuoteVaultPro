# AI Operator authority convergence (Phase 2B)

Generated from the Phase 1 inventory, authoritative command metadata, and retained legacy grant-map extractions. This is developer-only cutover evidence; runtime authority now uses the shared tenant-role policy.

## Trusted authority sources

- Authentication: authenticated request identity (`claims.sub` or `id`).
- Tenant and organization role: `tenantContext`, backed by the tenant membership record.
- Runtime role-to-grant mapping: `shared/organizationRoleAuthority.ts` through `AssistantActorAuthorityResolver`.
- Legacy chat/execution maps remain diagnostic-only and cannot grant authority.

## Known grant divergence

- Member chat grants: 3; member execution synthetic grants: 28; execution-only: 25.
- Admin chat grants: 8; admin execution synthetic grants: 37; execution-only: 31.
- Commands with known permission metadata outside member chat grants: 37.
- Commands with known permission metadata outside admin chat grants: 32.

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

## Command metadata resolution

All production command permission mappings are source-backed by command definitions.

## Descriptive mirror gaps

None.

## Remaining authority questions

- `super_admin` is not a tenant role mapped by the shared policy and resolves UNKNOWN.
- Command `allowedRoles` and `requiredCapability` are both runtime execution gates.
- Route families use non-uniform authorization middleware, so normal application authority remains partly unproven.
