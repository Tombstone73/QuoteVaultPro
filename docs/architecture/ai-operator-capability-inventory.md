# AI Operator capability and authority inventory

> Generated from `server/services/assistant/capabilityInventory.ts`. This is a source-backed developer projection; canonical registry metadata is the capability description authority.

## Scope

`unknown` means the source audit did not establish the fact conclusively. This report never registers or executes capabilities.

## Authorization sources

| Source | Applies to | Permission authority | Finding |
|---|---|---|---|
| ui.route.middleware | normal UI reads and mutations | server/routes.ts | Route middleware is the UI authority, but exact policy varies by route and several routes use only authentication plus tenant context. |
| assistant.shared.authority | chat, execution-plan creation, GO confirmation, command execution | shared/organizationRoleAuthority.ts | Shared tenant-role policy supplies grants to both chat and execution; command requiredCapability and allowedRoles are both enforced. |
| assistant.read.tool | AI read tool execution | server/services/assistant/toolRegistry.ts | Read-tool policy is explicit and requires the server-derived internal-staff marker. |
| assistant.capability.registry | capability description and filtering | server/services/assistant/canonicalCapabilityRegistry.ts | Canonical registry projections describe reviewed tools and commands; server-owned authority and execution definitions remain enforcement boundaries. |
| assistant.execution.shared_scope | execution-plan creation, GO confirmation, command execution | server/services/assistant/actorAuthorityResolver.ts | Execution uses the same resolver grants as chat and checks each command's required capability and allowed roles at planning, confirmation, and execution. |
| assistant.command.definition | command registration and execution metadata | server/services/assistant/execution/commandRegistry.ts | Commands declare required capability and allowed roles; both are carried into the execution registry and enforced. |

## Canonical command-metadata gaps

None.

## Product parity fixture

| Product area | Classification | Notes |
|---|---|---|
| Name / identity | shared_canonical_today | Existing edits share products.update_configuration.v1; new drafts compose the same proposal schema before a Product ID exists. |
| Description | shared_canonical_today | Product Editor and confirmed existing-product Operator share products.update_configuration.v1. |
| Category / type | shared_canonical_today | Category and validated Product type are shared for existing Products. |
| Measurement mode | shared_canonical_today | Existing edits and pre-persistence semantic proposals share the canonical configuration shape. |
| Workflow intent | shared_canonical_today | Workflow intent and established service-fee defaults are shared canonical. |
| Scalar pricing | shared_canonical_today | Product Editor metadata/PBV2 saves, canonical Product intent proposals, and scalar change sets share products.update_pricing.v1 validation and persistence boundaries. |
| Pricing matrices | shared_canonical_today | Product Editor DRAFT saves and the inactive-DRAFT compatibility command share canonical matrix validation; AI lifecycle scope remains intentionally narrower. |
| Quantity tiers | shared_canonical_today | Product Editor DRAFT saves and the inactive-DRAFT compatibility command share canonical tier validation; AI lifecycle scope remains intentionally narrower. |
| Primary material | shared_canonical_today | Product Editor, confirmed existing-Product edits, and canonical new-draft proposals share products.update_material_configuration.v1 tenant/active validation. Material links and PBV2 consumption/overrides remain separate. |
| Option groups and values | shared_canonical_today | Existing edits execute the shared operation; new drafts compose and apply its mutation schema through a pre-persistence adapter. |
| Defaults | shared_canonical_today | Defaults are validated against choice values; set_option_default is compatibility-only and translates to the shared operation. |
| Required state | shared_canonical_today | Group and input required state use the same PBV2 DRAFT operation. |
| Conditional rules | shared_canonical_today | Simple node/group/choice visibility uses validated selectionKey and choice-value references; complex nested authoring remains unmigrated. |
| Free-form/text inputs | shared_canonical_today | Text and textarea INPUT nodes, including conditional fields, are shared canonical. |
| Proof requirements | shared_canonical_today | Existing Product proof requirement is shared canonical. |
| Prepress and production routing | ui_supported_ai_adapter_missing | No normal Operator product operation found. |
| Active/inactive, draft/publish | ui_supported_ai_adapter_missing | Operator capabilities explicitly report product activation disabled. |
| Customer-specific availability | underlying_support_not_demonstrated | Proposal contract preserves this as unsupported without poisoning independent supported work. |
| Exact grommet-count structure | underlying_support_not_demonstrated | Preserved as unresolved; no phrase-specific choice repair remains active. |

## Capability inventory by domain

### products

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.read.products.get_summary | read | unknown | read_tool | products.get_summary | catalog_read | partial_or_indirect |
| ai.read.products.get_pricing | read | unknown | read_tool | products.get_pricing | finance_read | partial_or_indirect |
| ai.command.products.create_inactive_draft | mutation | unknown | command_plan_only | products.create_inactive_draft | assistant.products.create_inactive_draft | partial_or_indirect |
| ai.command.products.create_inactive_draft_batch | mutation | unknown | command_plan_only | products.create_inactive_draft_batch | assistant.products.create_inactive_draft_batch | partial_or_indirect |
| ai.command.products.update_inactive_draft | mutation | unknown | command_plan_only | products.update_inactive_draft | assistant.products.update_inactive_draft | partial_or_indirect |
| ai.command.products.update_inactive_draft_batch | mutation | unknown | command_plan_only | products.update_inactive_draft_batch | assistant.products.update_inactive_draft_batch | partial_or_indirect |
| ai.command.products.create_configurable_draft | mutation | unknown | command_plan_only | products.create_configurable_draft | assistant.products.create_inactive_draft | partial_or_indirect |
| ai.command.products.create_from_canonical_intent | mutation | unknown | command_plan_only | products.create_from_canonical_intent | assistant.products.create_inactive_draft | partial_or_indirect |
| ai.command.products.clone_to_inactive_draft | mutation | unknown | command_plan_only | products.clone_to_inactive_draft | assistant.products.clone_to_inactive_draft | partial_or_indirect |
| ai.command.products.update_existing_product | mutation | unknown | command_plan_only | products.update_existing_product | assistant.products.update_existing_product | partial_or_indirect |
| ui.products.edit_primary_fields | mutation | page_and_route | none | — | owner_or_admin | ui_supported_ai_adapter_missing |
| ui.products.activate_published_configuration | mutation | page_and_route | command_plan_only | products.update_existing_product | admin | shared_canonical_today |

### pbv2_pricing

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.command.products.adjust_pricing | mutation | unknown | command_plan_only | products.adjust_pricing | assistant.products.adjust_pricing | shared_canonical_today |
| ai.command.products.rollback_pricing_change_set | mutation | unknown | command_plan_only | products.rollback_pricing_change_set | assistant.products.adjust_pricing | shared_canonical_today |
| ai.command.products.replace_inactive_matrix | mutation | unknown | command_plan_only | products.replace_inactive_matrix | assistant.products.replace_inactive_matrix | shared_canonical_today |
| ai.command.products.replace_inactive_quantity_tiers | mutation | unknown | command_plan_only | products.replace_inactive_quantity_tiers | assistant.products.replace_inactive_quantity_tiers | shared_canonical_today |
| ui.pbv2.save_draft_tree | mutation | page_and_route | command_plan_only | products.update_existing_product | authenticated_tenant_user (UI); assistant.products.update_existing_product (AI) | shared_canonical_today |

### quotes

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.read.quotes.search | read | unknown | read_tool | quotes.search | internal_staff | partial_or_indirect |
| ai.read.quotes.get_detail | read | unknown | read_tool | quotes.get_detail | internal_staff | partial_or_indirect |
| ai.command.quotes.add_internal_note | mutation | unknown | command_plan_only | quotes.add_internal_note | assistant.quotes.add_internal_note | partial_or_indirect |
| ai.command.quotes.create_draft | mutation | unknown | command_plan_only | quotes.create_draft | assistant.quotes.create_draft | partial_or_indirect |
| ai.command.quotes.update_draft | mutation | unknown | command_plan_only | quotes.update_draft | assistant.quotes.update_draft | partial_or_indirect |
| ai.command.quotes.convert_to_order | mutation | unknown | command_plan_only | quotes.convert_to_order | assistant.quotes.convert_to_order | partial_or_indirect |
| ui.quotes.manage_quote | mutation | page_and_route | none | — | authenticated_tenant_user | ui_supported_ai_adapter_missing |

### orders

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.read.orders.search | read | unknown | read_tool | orders.search | internal_staff | partial_or_indirect |
| ai.read.orders.get_summary | read | unknown | read_tool | orders.get_summary | internal_staff | partial_or_indirect |
| ai.read.orders.get_due_summary | read | unknown | read_tool | orders.get_due_summary | internal_staff | partial_or_indirect |
| ai.command.orders.create | mutation | unknown | command_plan_only | orders.create | assistant.orders.create | partial_or_indirect |
| ai.command.orders.update_editable | mutation | unknown | command_plan_only | orders.update_editable | assistant.orders.update_editable | partial_or_indirect |
| ui.orders.manage_order_lifecycle | mutation | page_and_route | none | — | route_specific_or_unknown | ui_supported_ai_adapter_missing |

### proofing

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ui.proofing.order_proof_policy | mutation | page_and_route | none | — | owner_or_admin | ui_supported_ai_adapter_missing |

### prepress

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ui.prepress.manage_sessions_and_files | mutation | page_and_route | command_plan_only | — | route_specific_or_unknown | partial_or_indirect |

### production

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.read.production.get_queue_summary | read | unknown | read_tool | production.get_queue_summary | internal_staff | partial_or_indirect |
| ai.read.production.get_completed_jobs | read | unknown | read_tool | production.get_completed_jobs | internal_staff | partial_or_indirect |
| ai.command.production.intake_line_items | mutation | unknown | command_plan_only | production.intake_line_items | assistant.production.intake_line_items | shared_canonical_today |
| ai.command.production.send_to_prepress | mutation | unknown | command_plan_only | production.send_to_prepress | assistant.production.send_to_prepress | shared_canonical_today |
| ai.command.production.update_job_status | mutation | unknown | command_plan_only | production.update_job_status | assistant.production.update_job_status | shared_canonical_today |
| ai.command.production.add_job_note | mutation | unknown | command_plan_only | production.add_job_note | assistant.production.add_job_note | shared_canonical_today |
| ui.production.manage_jobs | mutation | page_and_route | command_plan_only | — | authenticated_tenant_user (UI); reviewed GO command subset (AI) | partial_or_indirect |

### fulfillment

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.command.fulfillment.create_shipment | mutation | unknown | command_plan_only | fulfillment.create_shipment | assistant.fulfillment.create_shipment | shared_canonical_today |
| ai.command.fulfillment.update_shipment_details | mutation | unknown | command_plan_only | fulfillment.update_shipment_details | assistant.fulfillment.update_shipment_details | shared_canonical_today |
| ai.command.fulfillment.mark_shipped | mutation | unknown | command_plan_only | fulfillment.mark_shipped | assistant.fulfillment.mark_shipped | shared_canonical_today |
| ai.command.fulfillment.create_pickup_ticket | mutation | unknown | command_plan_only | fulfillment.create_pickup_ticket | assistant.fulfillment.create_pickup_ticket | shared_canonical_today |
| ai.command.fulfillment.add_note | mutation | unknown | command_plan_only | fulfillment.add_note | assistant.fulfillment.add_note | shared_canonical_today |
| ui.fulfillment.manage_orders_shipments_pickups | mutation | page_and_route | command_plan_only | — | authenticated_tenant_user (UI); reviewed GO command subset (AI) | partial_or_indirect |

### invoicing

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.command.billing.create_invoice | mutation | unknown | command_plan_only | billing.create_invoice | assistant.billing.create_invoice | shared_canonical_today |
| ai.command.billing.update_invoice_draft | mutation | unknown | command_plan_only | billing.update_invoice_draft | assistant.billing.update_invoice_draft | shared_canonical_today |
| ai.command.billing.send_invoice | mutation | unknown | command_plan_only | billing.send_invoice | assistant.billing.send_invoice | shared_canonical_today |
| ai.command.billing.add_invoice_note | mutation | unknown | command_plan_only | billing.add_invoice_note | assistant.billing.add_invoice_note | shared_canonical_today |
| ui.invoicing.manage_invoice | mutation | page_and_route | command_plan_only | — | route_specific_or_unknown | partial_or_indirect |

### payments

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.command.payments.record_manual_payment | mutation | unknown | command_plan_only | payments.record_manual_payment | assistant.payments.record_manual_payment | shared_canonical_today |
| ai.command.payments.add_payment_note | mutation | unknown | command_plan_only | payments.add_payment_note | assistant.payments.add_payment_note | shared_canonical_today |
| ui.payments.record_and_manage | mutation | page_and_route | command_plan_only | — | authenticated_tenant_user (UI); reviewed GO command subset (AI) | partial_or_indirect |

### customers

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.read.customers.get_summary | read | unknown | read_tool | customers.get_summary | internal_staff | partial_or_indirect |
| ai.read.analytics.resolve_customer | read | unknown | read_tool | analytics.resolve_customer | finance_read | partial_or_indirect |
| ai.read.analytics.customer_product_sales | read | unknown | read_tool | analytics.customer_product_sales | finance_read | partial_or_indirect |
| ai.read.analytics.customer_uninvoiced_orders | read | unknown | read_tool | analytics.customer_uninvoiced_orders | finance_read | partial_or_indirect |
| ai.read.analytics.invoice_activity | read | unknown | read_tool | analytics.invoice_activity | finance_read | partial_or_indirect |
| ai.command.customers.create | mutation | unknown | command_plan_only | customers.create | assistant.customers.create | shared_canonical_today |
| ai.command.customers.update_profile | mutation | unknown | command_plan_only | customers.update_profile | assistant.customers.update_profile | shared_canonical_today |
| ai.command.customers.update_commercial_terms | mutation | unknown | command_plan_only | customers.update_commercial_terms | assistant.customers.update_commercial_terms | shared_canonical_today |
| ui.customers.manage_customer | mutation | page_and_route | command_plan_only | — | route_specific_or_unknown | partial_or_indirect |

### contacts

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.command.contacts.create | mutation | unknown | command_plan_only | contacts.create | assistant.contacts.create | shared_canonical_today |
| ai.command.contacts.update | mutation | unknown | command_plan_only | contacts.update | assistant.contacts.update | shared_canonical_today |
| ui.contacts.manage_contact_relationships | mutation | page_and_route | command_plan_only | — | authenticated_tenant_user | partial_or_indirect |

### materials

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ui.materials.manage_inventory | mutation | page_and_route | none | — | owner_or_admin | ui_supported_ai_adapter_missing |

### settings_permissions

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.read.search.global | read | unknown | read_tool | search.global | internal_staff | partial_or_indirect |
| ai.read.reports.operational_summary | read | unknown | read_tool | reports.operational_summary | internal_staff | partial_or_indirect |
| ai.read.navigation.get_current_context | read | unknown | read_tool | navigation.get_current_context | internal_staff | partial_or_indirect |
| ai.read.operations.get_attention_summary | read | unknown | read_tool | operations.get_attention_summary | internal_staff | partial_or_indirect |
| ui.settings.organization_preferences | mutation | page_and_route | none | — | owner_or_admin | ui_supported_ai_adapter_missing |

### public_research

| Provisional capability | Mode | UI | AI | Tool / command | Permission | Parity |
|---|---|---|---|---|---|---|
| ai.public_research | read | none | provider_native_tool | — | assistant_enabled_and_provider_capability | partial_or_indirect |
