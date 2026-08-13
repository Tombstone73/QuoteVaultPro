# Final AI Operator migration inventory

> Generated from canonical registry metadata and the reviewed Product unsupported fixture. This is a developer-facing classification report, not an execution surface.

## Counts

- shared_canonical: 26
- compatibility_only: 30
- ui_only_reviewed: 1
- ai_integration_pending: 1
- deliberately_ai_ineligible: 2
- hard_denied: 7
- underlying_model_unsupported: 2

## customers_contacts

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.read.customers.get_summary | compatibility_only | unknown | existing | not_applicable | customers.get_summary | assistant.internal_staff | not_required | not_applicable |
| capability.read.analytics.resolve_customer | compatibility_only | unknown | existing | not_applicable | analytics.resolve_customer | finance.read | not_required | not_applicable |
| capability.read.analytics.customer_product_sales | compatibility_only | unknown | existing | not_applicable | analytics.customer_product_sales | finance.read | not_required | not_applicable |
| capability.read.analytics.customer_uninvoiced_orders | compatibility_only | unknown | existing | not_applicable | analytics.customer_uninvoiced_orders | finance.read | not_required | not_applicable |
| capability.read.analytics.invoice_activity | compatibility_only | unknown | existing | not_applicable | analytics.invoice_activity | finance.read | not_required | not_applicable |
| capability.command.customers.create | shared_canonical | Customer and Contact routes | existing | customers.create.v1 | customers.create | assistant.customers.create | go_required | CanonicalCustomerContactOperations |
| capability.command.customers.update_profile | shared_canonical | Customer and Contact routes | existing | customers.update.v1 | customers.update_profile | assistant.customers.update_profile | go_required | CanonicalCustomerContactOperations |
| capability.command.customers.update_commercial_terms | shared_canonical | Customer and Contact routes | existing | customers.update.v1 | customers.update_commercial_terms | assistant.customers.update_commercial_terms | go_required | CanonicalCustomerContactOperations |
| capability.command.contacts.create | shared_canonical | Customer and Contact routes | existing | contacts.create.v1 | contacts.create | assistant.contacts.create | go_required | CanonicalCustomerContactOperations |
| capability.command.contacts.update | shared_canonical | Customer and Contact routes | existing | contacts.update.v1 | contacts.update | assistant.contacts.update | go_required | CanonicalCustomerContactOperations |

## fulfillment

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.command.fulfillment.create_shipment | shared_canonical | Fulfillment routes | existing | fulfillment.update_shipment.v1 | fulfillment.create_shipment | assistant.fulfillment.create_shipment | go_required | CanonicalFulfillmentOperations / FulfillmentService |
| capability.command.fulfillment.update_shipment_details | shared_canonical | Fulfillment routes | existing | fulfillment.update_shipment.v1 | fulfillment.update_shipment_details | assistant.fulfillment.update_shipment_details | go_required | CanonicalFulfillmentOperations / FulfillmentService |
| capability.command.fulfillment.mark_shipped | shared_canonical | Fulfillment routes | existing | fulfillment.update_shipment.v1 | fulfillment.mark_shipped | assistant.fulfillment.mark_shipped | go_required | CanonicalFulfillmentOperations / FulfillmentService |
| capability.command.fulfillment.create_pickup_ticket | shared_canonical | Fulfillment routes | existing | fulfillment.update_shipment.v1 | fulfillment.create_pickup_ticket | assistant.fulfillment.create_pickup_ticket | go_required | CanonicalFulfillmentOperations / FulfillmentService |
| capability.command.fulfillment.add_note | shared_canonical | Fulfillment routes | existing | fulfillment.update_shipment.v1 | fulfillment.add_note | assistant.fulfillment.add_note | go_required | CanonicalFulfillmentOperations / FulfillmentService |

## invoicing

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.command.billing.create_invoice | shared_canonical | Invoice detail and Order billing routes | existing | invoice.create_draft_from_order.v1 | billing.create_invoice | assistant.billing.create_invoice | go_required | CanonicalInvoiceOperations |
| capability.command.billing.update_invoice_draft | shared_canonical | Invoice detail and Order billing routes | existing | invoice.update_draft.v1 | billing.update_invoice_draft | assistant.billing.update_invoice_draft | go_required | CanonicalInvoiceOperations |
| capability.command.billing.send_invoice | shared_canonical | Invoice detail and Order billing routes | existing | invoice.mark_sent.v1 | billing.send_invoice | assistant.billing.send_invoice | go_required | CanonicalInvoiceOperations |
| capability.command.billing.add_invoice_note | shared_canonical | Invoice detail and Order billing routes | existing | invoice.add_internal_note.v1 | billing.add_invoice_note | assistant.billing.add_invoice_note | go_required | CanonicalInvoiceOperations |

## orders

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.read.orders.search | shared_canonical | Orders list; GET /api/orders | existing | OrdersRepository.getAllOrdersPaginated | orders.search | assistant.internal_staff | not_required | not_applicable |
| capability.read.orders.get_summary | compatibility_only | unknown | existing | not_applicable | orders.get_summary | assistant.internal_staff | not_required | not_applicable |
| capability.read.orders.get_due_summary | compatibility_only | unknown | existing | not_applicable | orders.get_due_summary | assistant.internal_staff | not_required | not_applicable |
| capability.command.orders.create | compatibility_only | unknown | existing | not_applicable | orders.create | assistant.orders.create | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.orders.update_editable | compatibility_only | unknown | existing | not_applicable | orders.update_editable | assistant.orders.update_editable | go_required | server/services/assistant/execution/*ExecutionCommand.ts |

## payments

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.command.payments.record_manual_payment | shared_canonical | Invoice manual-payment routes | existing | payments.record_manual_payment.v1 | payments.record_manual_payment | assistant.payments.record_manual_payment | go_required | CanonicalPaymentOperations |
| capability.command.payments.add_payment_note | shared_canonical | Invoice manual-payment routes | existing | payments.add_internal_note.v1 | payments.add_payment_note | assistant.payments.add_payment_note | go_required | CanonicalPaymentOperations |

## pricing

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.read.products.get_pricing | compatibility_only | unknown | existing | not_applicable | products.get_pricing | finance.read | not_required | not_applicable |
| capability.command.products.adjust_pricing | shared_canonical | Product Editor PATCH /api/products/:id; PUT /api/products/:productId/pbv2/draft | existing | products.update_pricing.v1 | products.adjust_pricing | assistant.products.adjust_pricing | go_required | CanonicalProductPricingOperations |
| capability.command.products.rollback_pricing_change_set | shared_canonical | Product Editor PATCH /api/products/:id; PUT /api/products/:productId/pbv2/draft | existing | products.update_pricing.v1 | products.rollback_pricing_change_set | assistant.products.adjust_pricing | go_required | CanonicalProductPricingOperations |
| capability.command.products.replace_inactive_matrix | shared_canonical | Product Editor PATCH /api/products/:id; PUT /api/products/:productId/pbv2/draft | existing | products.replace_pricing_matrix.v1 | products.replace_inactive_matrix | assistant.products.replace_inactive_matrix | go_required | CanonicalProductPricingOperations |
| capability.command.products.replace_inactive_quantity_tiers | shared_canonical | Product Editor PATCH /api/products/:id; PUT /api/products/:productId/pbv2/draft | existing | products.replace_quantity_tiers.v1 | products.replace_inactive_quantity_tiers | assistant.products.replace_inactive_quantity_tiers | go_required | CanonicalProductPricingOperations |

## production

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.read.production.get_queue_summary | compatibility_only | unknown | existing | not_applicable | production.get_queue_summary | assistant.internal_staff | not_required | not_applicable |
| capability.read.production.get_completed_jobs | compatibility_only | unknown | existing | not_applicable | production.get_completed_jobs | assistant.internal_staff | not_required | not_applicable |
| capability.command.production.intake_line_items | shared_canonical | Production board routes | existing | production.intake_line_items.v1 | production.intake_line_items | assistant.production.intake_line_items | go_required | CanonicalProductionOperations / CanonicalPrepressOperations |
| capability.command.production.send_to_prepress | shared_canonical | Production board routes | existing | prepress.return_from_production.v1 | production.send_to_prepress | assistant.production.send_to_prepress | go_required | CanonicalProductionOperations / CanonicalPrepressOperations |
| capability.command.production.update_job_status | shared_canonical | Production board routes | existing | production.start_job.v1 | production.update_job_status | assistant.production.update_job_status | go_required | CanonicalProductionOperations / CanonicalPrepressOperations |
| capability.command.production.add_job_note | shared_canonical | Production board routes | existing | production.add_job_note.v1 | production.add_job_note | assistant.production.add_job_note | go_required | CanonicalProductionOperations / CanonicalPrepressOperations |

## products

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.read.products.get_summary | compatibility_only | unknown | existing | not_applicable | products.get_summary | catalog.read | not_required | not_applicable |
| capability.command.products.create_inactive_draft | compatibility_only | unknown | existing | not_applicable | products.create_inactive_draft | assistant.products.create_inactive_draft | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.products.create_inactive_draft_batch | compatibility_only | unknown | existing | not_applicable | products.create_inactive_draft_batch | assistant.products.create_inactive_draft_batch | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.products.update_inactive_draft | compatibility_only | unknown | existing | not_applicable | products.update_inactive_draft | assistant.products.update_inactive_draft | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.products.update_inactive_draft_batch | compatibility_only | unknown | existing | not_applicable | products.update_inactive_draft_batch | assistant.products.update_inactive_draft_batch | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.products.create_configurable_draft | compatibility_only | unknown | existing | not_applicable | products.create_configurable_draft | assistant.products.create_inactive_draft | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.products.create_from_canonical_intent | compatibility_only | unknown | existing | not_applicable | products.create_from_canonical_intent | assistant.products.create_inactive_draft | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.products.clone_to_inactive_draft | compatibility_only | unknown | existing | not_applicable | products.clone_to_inactive_draft | assistant.products.clone_to_inactive_draft | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.products.update_existing_product | shared_canonical | Product Editor PATCH /api/products/:id; PUT /api/products/:productId/pbv2/draft; POST /api/pbv2/tree-versions/:id/publish | existing | products.update_configuration.v1; products.update_option_configuration.v1; products.update_material_configuration.v1; products.update_lifecycle.v1; products.publish_configuration.v1; products.update_pricing_engine_configuration.v1 | products.update_existing_product | assistant.products.update_existing_product | go_required | CanonicalProductConfigurationOperations + CanonicalPbv2OptionConfigurationOperations + CanonicalProductMaterialOperations + CanonicalProductLifecycleOperations + CanonicalProductPublishOperations + CanonicalProductPricingEngineConfigurationOperations |
| capability.ui.products.pricing_formula_profile | ai_integration_pending | Product Editor Pricing Engine | not_exposed | products.update_pricing.v1 (UI metadata only) | products.pricing_formula_profile | assistant.products.update_existing_product | go_required | Product Editor pricing/PBV2 save orchestration |
| capability.ui.products.delete | deliberately_ai_ineligible | Product administration | not_exposed | not_applicable | products.delete | product.delete | not_required | Product route policy |
| capability.ui.products.advanced_pbv2_override | deliberately_ai_ineligible | Advanced Product administration | not_exposed | not_applicable | products.advanced_pbv2_override | product.update | not_required | PBV2 override route policy |
| product.products.customer_specific | underlying_model_unsupported | unknown | not_exposed | not_applicable | — | — | not_applicable | Proposal contract preserves this as unsupported without poisoning independent supported work. |
| product.products.grommet_quantity | underlying_model_unsupported | unknown | not_exposed | not_applicable | — | — | not_applicable | Preserved as unresolved; no phrase-specific choice repair remains active. |

## quotes

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.read.quotes.search | compatibility_only | unknown | existing | not_applicable | quotes.search | assistant.internal_staff | not_required | not_applicable |
| capability.read.quotes.get_detail | compatibility_only | unknown | existing | not_applicable | quotes.get_detail | assistant.internal_staff | not_required | not_applicable |
| capability.command.quotes.add_internal_note | compatibility_only | unknown | existing | not_applicable | quotes.add_internal_note | assistant.quotes.add_internal_note | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.quotes.create_draft | compatibility_only | unknown | existing | not_applicable | quotes.create_draft | assistant.quotes.create_draft | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.quotes.update_draft | compatibility_only | unknown | existing | not_applicable | quotes.update_draft | assistant.quotes.update_draft | go_required | server/services/assistant/execution/*ExecutionCommand.ts |
| capability.command.quotes.convert_to_order | compatibility_only | unknown | existing | not_applicable | quotes.convert_to_order | assistant.quotes.convert_to_order | go_required | server/services/assistant/execution/*ExecutionCommand.ts |

## security

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.hard_deny.organization.delete | hard_denied | unknown | not_exposed | not_applicable | organization.delete | — | not_required | not_applicable |
| capability.hard_deny.organization.destroy_tenant | hard_denied | unknown | not_exposed | not_applicable | organization.destroy_tenant | — | not_required | not_applicable |
| capability.hard_deny.organization.transfer_ownership | hard_denied | unknown | not_exposed | not_applicable | organization.transfer_ownership | — | not_required | not_applicable |
| capability.hard_deny.platform.developer_operations | hard_denied | unknown | not_exposed | not_applicable | platform.developer_operations | — | not_required | not_applicable |
| capability.hard_deny.platform.infrastructure_administration | hard_denied | unknown | not_exposed | not_applicable | platform.infrastructure_administration | — | not_required | not_applicable |
| capability.hard_deny.platform.cross_tenant_mutation | hard_denied | unknown | not_exposed | not_applicable | platform.cross_tenant_mutation | — | not_required | not_applicable |
| capability.hard_deny.platform.arbitrary_database_or_api_execution | hard_denied | unknown | not_exposed | not_applicable | platform.arbitrary_database_or_api_execution | — | not_required | not_applicable |

## settings_permissions

| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |
|---|---|---|---|---|---|---|---|---|
| capability.read.search.global | compatibility_only | unknown | existing | not_applicable | search.global | assistant.internal_staff | not_required | not_applicable |
| capability.read.reports.operational_summary | compatibility_only | unknown | existing | not_applicable | reports.operational_summary | assistant.internal_staff | not_required | not_applicable |
| capability.read.navigation.get_current_context | compatibility_only | unknown | existing | not_applicable | navigation.get_current_context | assistant.internal_staff | not_required | not_applicable |
| capability.read.operations.get_attention_summary | compatibility_only | unknown | existing | not_applicable | operations.get_attention_summary | assistant.internal_staff | not_required | not_applicable |
| capability.ui.settings.organization_preferences | ui_only_reviewed | Organization Settings | not_exposed | not_applicable | organization.preferences.update | organization.settings.update | not_required | not_applicable |
