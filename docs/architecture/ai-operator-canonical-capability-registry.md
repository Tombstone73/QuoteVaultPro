# Canonical AI capability registry

> Generated from `server/services/assistant/canonicalCapabilityRegistry.ts`. This is metadata and discovery only; it is not a generic execution API.

## Counts

- Registered: 64
- Read: 17
- Mutation: 38
- Eligible: 55
- Ineligible: 2
- Hard denied: 7

## Registry

| Capability ID | Domain | Mode | Source | Existing ID | Required grant | AI eligibility | Hard-deny reason | Operator skill | Migration status |
|---|---|---|---|---|---|---|---|---|---|
| capability.read.search.global | settings_permissions | read | read_tool | search.global | assistant.internal_staff | eligible | — | settings.permissions | wrapped_existing |
| capability.read.quotes.search | quotes | read | read_tool | quotes.search | assistant.internal_staff | eligible | — | quotes.operations | wrapped_existing |
| capability.read.quotes.get_detail | quotes | read | read_tool | quotes.get_detail | assistant.internal_staff | eligible | — | quotes.operations | wrapped_existing |
| capability.read.customers.get_summary | customers_contacts | read | read_tool | customers.get_summary | assistant.internal_staff | eligible | — | customers.contacts | wrapped_existing |
| capability.read.orders.get_summary | orders | read | read_tool | orders.get_summary | assistant.internal_staff | eligible | — | orders.operations | wrapped_existing |
| capability.read.products.get_summary | products | read | read_tool | products.get_summary | catalog.read | eligible | — | products.pbv2 | wrapped_existing |
| capability.read.products.get_pricing | pricing | read | read_tool | products.get_pricing | finance.read | eligible | — | pricing.pbv2 | wrapped_existing |
| capability.read.reports.operational_summary | settings_permissions | read | read_tool | reports.operational_summary | assistant.internal_staff | eligible | — | settings.permissions | wrapped_existing |
| capability.read.navigation.get_current_context | settings_permissions | read | read_tool | navigation.get_current_context | assistant.internal_staff | eligible | — | settings.permissions | wrapped_existing |
| capability.read.production.get_queue_summary | production | read | read_tool | production.get_queue_summary | assistant.internal_staff | eligible | — | production.operations | wrapped_existing |
| capability.read.operations.get_attention_summary | settings_permissions | read | read_tool | operations.get_attention_summary | assistant.internal_staff | eligible | — | settings.permissions | wrapped_existing |
| capability.read.orders.get_due_summary | orders | read | read_tool | orders.get_due_summary | assistant.internal_staff | eligible | — | orders.operations | wrapped_existing |
| capability.read.production.get_completed_jobs | production | read | read_tool | production.get_completed_jobs | assistant.internal_staff | eligible | — | production.operations | wrapped_existing |
| capability.read.analytics.resolve_customer | customers_contacts | read | read_tool | analytics.resolve_customer | finance.read | eligible | — | customers.contacts | wrapped_existing |
| capability.read.analytics.customer_product_sales | customers_contacts | read | read_tool | analytics.customer_product_sales | finance.read | eligible | — | customers.contacts | wrapped_existing |
| capability.read.analytics.customer_uninvoiced_orders | customers_contacts | read | read_tool | analytics.customer_uninvoiced_orders | finance.read | eligible | — | customers.contacts | wrapped_existing |
| capability.read.analytics.invoice_activity | customers_contacts | read | read_tool | analytics.invoice_activity | finance.read | eligible | — | customers.contacts | wrapped_existing |
| capability.command.quotes.add_internal_note | quotes | mutation | command | quotes.add_internal_note | assistant.quotes.add_internal_note | eligible | — | quotes.operations | wrapped_existing |
| capability.command.products.create_inactive_draft | products | mutation | command | products.create_inactive_draft | assistant.products.create_inactive_draft | eligible | — | products.pbv2 | wrapped_existing |
| capability.command.products.create_inactive_draft_batch | products | mutation | command | products.create_inactive_draft_batch | assistant.products.create_inactive_draft_batch | eligible | — | products.pbv2 | wrapped_existing |
| capability.command.products.update_inactive_draft | products | mutation | command | products.update_inactive_draft | assistant.products.update_inactive_draft | eligible | — | products.pbv2 | wrapped_existing |
| capability.command.products.update_inactive_draft_batch | products | mutation | command | products.update_inactive_draft_batch | assistant.products.update_inactive_draft_batch | eligible | — | products.pbv2 | wrapped_existing |
| capability.command.products.adjust_pricing | pricing | mutation | command | products.adjust_pricing | assistant.products.adjust_pricing | eligible | — | pricing.pbv2 | shared_canonical |
| capability.command.products.rollback_pricing_change_set | pricing | mutation | command | products.rollback_pricing_change_set | assistant.products.adjust_pricing | eligible | — | pricing.pbv2 | shared_canonical |
| capability.command.products.create_configurable_draft | products | mutation | command | products.create_configurable_draft | assistant.products.create_inactive_draft | eligible | — | products.pbv2 | wrapped_existing |
| capability.command.products.create_from_canonical_intent | products | mutation | command | products.create_from_canonical_intent | assistant.products.create_inactive_draft | eligible | — | products.pbv2 | wrapped_existing |
| capability.command.products.clone_to_inactive_draft | products | mutation | command | products.clone_to_inactive_draft | assistant.products.clone_to_inactive_draft | eligible | — | products.pbv2 | wrapped_existing |
| capability.command.products.replace_inactive_matrix | pricing | mutation | command | products.replace_inactive_matrix | assistant.products.replace_inactive_matrix | eligible | — | pricing.pbv2 | shared_canonical |
| capability.command.products.replace_inactive_quantity_tiers | pricing | mutation | command | products.replace_inactive_quantity_tiers | assistant.products.replace_inactive_quantity_tiers | eligible | — | pricing.pbv2 | shared_canonical |
| capability.command.products.update_existing_product | products | mutation | command | products.update_existing_product | assistant.products.update_existing_product | eligible | — | products.pbv2 | shared_canonical |
| capability.command.quotes.create_draft | quotes | mutation | command | quotes.create_draft | assistant.quotes.create_draft | eligible | — | quotes.operations | wrapped_existing |
| capability.command.quotes.update_draft | quotes | mutation | command | quotes.update_draft | assistant.quotes.update_draft | eligible | — | quotes.operations | wrapped_existing |
| capability.command.orders.create | orders | mutation | command | orders.create | assistant.orders.create | eligible | — | orders.operations | wrapped_existing |
| capability.command.orders.update_editable | orders | mutation | command | orders.update_editable | assistant.orders.update_editable | eligible | — | orders.operations | wrapped_existing |
| capability.command.quotes.convert_to_order | quotes | mutation | command | quotes.convert_to_order | assistant.quotes.convert_to_order | eligible | — | quotes.operations | wrapped_existing |
| capability.command.customers.create | customers_contacts | mutation | command | customers.create | assistant.customers.create | eligible | — | customers.contacts | shared_canonical |
| capability.command.customers.update_profile | customers_contacts | mutation | command | customers.update_profile | assistant.customers.update_profile | eligible | — | customers.contacts | shared_canonical |
| capability.command.customers.update_commercial_terms | customers_contacts | mutation | command | customers.update_commercial_terms | assistant.customers.update_commercial_terms | eligible | — | customers.contacts | shared_canonical |
| capability.command.contacts.create | customers_contacts | mutation | command | contacts.create | assistant.contacts.create | eligible | — | customers.contacts | shared_canonical |
| capability.command.contacts.update | customers_contacts | mutation | command | contacts.update | assistant.contacts.update | eligible | — | customers.contacts | shared_canonical |
| capability.command.production.intake_line_items | production | mutation | command | production.intake_line_items | assistant.production.intake_line_items | eligible | — | production.operations | shared_canonical |
| capability.command.production.send_to_prepress | production | mutation | command | production.send_to_prepress | assistant.production.send_to_prepress | eligible | — | production.operations | shared_canonical |
| capability.command.production.update_job_status | production | mutation | command | production.update_job_status | assistant.production.update_job_status | eligible | — | production.operations | shared_canonical |
| capability.command.production.add_job_note | production | mutation | command | production.add_job_note | assistant.production.add_job_note | eligible | — | production.operations | shared_canonical |
| capability.command.fulfillment.create_shipment | fulfillment | mutation | command | fulfillment.create_shipment | assistant.fulfillment.create_shipment | eligible | — | fulfillment.operations | shared_canonical |
| capability.command.fulfillment.update_shipment_details | fulfillment | mutation | command | fulfillment.update_shipment_details | assistant.fulfillment.update_shipment_details | eligible | — | fulfillment.operations | shared_canonical |
| capability.command.fulfillment.mark_shipped | fulfillment | mutation | command | fulfillment.mark_shipped | assistant.fulfillment.mark_shipped | eligible | — | fulfillment.operations | shared_canonical |
| capability.command.fulfillment.create_pickup_ticket | fulfillment | mutation | command | fulfillment.create_pickup_ticket | assistant.fulfillment.create_pickup_ticket | eligible | — | fulfillment.operations | shared_canonical |
| capability.command.fulfillment.add_note | fulfillment | mutation | command | fulfillment.add_note | assistant.fulfillment.add_note | eligible | — | fulfillment.operations | shared_canonical |
| capability.command.billing.create_invoice | invoicing | mutation | command | billing.create_invoice | assistant.billing.create_invoice | eligible | — | invoicing.operations | shared_canonical |
| capability.command.billing.update_invoice_draft | invoicing | mutation | command | billing.update_invoice_draft | assistant.billing.update_invoice_draft | eligible | — | invoicing.operations | shared_canonical |
| capability.command.billing.send_invoice | invoicing | mutation | command | billing.send_invoice | assistant.billing.send_invoice | eligible | — | invoicing.operations | shared_canonical |
| capability.command.billing.add_invoice_note | invoicing | mutation | command | billing.add_invoice_note | assistant.billing.add_invoice_note | eligible | — | invoicing.operations | shared_canonical |
| capability.command.payments.record_manual_payment | payments | mutation | command | payments.record_manual_payment | assistant.payments.record_manual_payment | eligible | — | payments.operations | shared_canonical |
| capability.command.payments.add_payment_note | payments | mutation | command | payments.add_payment_note | assistant.payments.add_payment_note | eligible | — | payments.operations | shared_canonical |
| capability.ui.products.activate | products | lifecycle | ui_compatibility | products.activate | products.activate | ineligible | — | products.pbv2 | compatibility_only |
| capability.ui.settings.organization_preferences | settings_permissions | administrative | ui_compatibility | organization.preferences.update | organization.settings.update | ineligible | — | settings.permissions | compatibility_only |
| capability.hard_deny.organization.delete | security | administrative | security_policy | organization.delete | — | hard_denied | Owner-only destructive organization action. | — | security_policy |
| capability.hard_deny.organization.destroy_tenant | security | administrative | security_policy | organization.destroy_tenant | — | hard_denied | Tenant destruction is never an AI capability. | — | security_policy |
| capability.hard_deny.organization.transfer_ownership | security | administrative | security_policy | organization.transfer_ownership | — | hard_denied | Owner-only irreversible organization control. | — | security_policy |
| capability.hard_deny.platform.developer_operations | security | administrative | security_policy | platform.developer_operations | — | hard_denied | Developer and internal operations are permanently excluded. | — | security_policy |
| capability.hard_deny.platform.infrastructure_administration | security | administrative | security_policy | platform.infrastructure_administration | — | hard_denied | Infrastructure and system administration are permanently excluded. | — | security_policy |
| capability.hard_deny.platform.cross_tenant_mutation | security | administrative | security_policy | platform.cross_tenant_mutation | — | hard_denied | Cross-tenant mutation is permanently excluded. | — | security_policy |
| capability.hard_deny.platform.arbitrary_database_or_api_execution | security | administrative | security_policy | platform.arbitrary_database_or_api_execution | — | hard_denied | Arbitrary database and backend execution are permanently excluded. | — | security_policy |
