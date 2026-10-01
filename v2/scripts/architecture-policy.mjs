// The document is authoritative; this is a mechanical projection of its facts.
// Unsettled row/concern splits remain deferred, never an owner permission.
const doc = "docs/architecture/v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md";
const groups = {
  authentication: ["Authentication / Permissions", "auth_identities org_invites user_organizations users v2_customer_portal_ceiling_capabilities v2_customer_portal_ceiling_policies v2_organization_portal_capability_defaults v2_permission_audit_events v2_permission_organization_state v2_permission_set_capabilities v2_permission_sets v2_portal_invitation_delivery_attempts v2_portal_permission_set_assignments v2_staff_permission_set_assignments v2_team_invitation_delivery_attempts"],
  settings: ["Settings", "company_settings organizations v2_sales_tax_jurisdictions"],
  customers: ["Customers / CRM", "customer_contact_links customer_contacts customer_notes customers"],
  deferred: ["BDR-1; BDR-3; BDR-5; Communications; Settings; Pricing / PBV2 ownership questions", "customer_portal_access customer_portal_invite_tokens pbv2_tree_versions v2_customer_product_commercial_events v2_customer_product_entitlements v2_customer_product_pricing_agreements v2_portal_password_reset_tokens v2_product_version_formula_revision_bindings v2_proof_delivery_jobs v2_sales_document_number_counters v2_audit_events"],
  integrations: ["Integrations", "email_settings v2_email_integration_audit_events v2_email_integrations v2_email_oauth_states v2_quickbooks_invoice_approvals v2_quickbooks_payment_reference_counters v2_quickbooks_payment_references v2_quickbooks_refund_sync_workflows v2_quickbooks_sync_jobs v2_quickbooks_sync_links v2_stripe_connect_accounts v2_stripe_connect_audit_events"],
  pricing: ["Pricing / PBV2", "formula_revisions v2_formula_identities"],
  inventory: ["Decision 4; Inventory / Materials", "materials v2_inventory_movements v2_inventory_reconciliation_attempts v2_inventory_reservations"],
  products: ["Decision 1; Products", "product_types products v2_product_recipe_components v2_product_recipes v2_product_version_routing_specs"],
  ai: ["AI", "v2_ai_conversation_messages v2_ai_conversations v2_ai_pending_commands v2_ai_tool_audit"],
  artwork: ["Artwork; Sales Decision C staged ownership", "v2_artwork_assignment_removals v2_artwork_assignments v2_artwork_files v2_artwork_storage_upload_intents v2_artwork_workspace_claims v2_quote_accepted_artwork_snapshots v2_quote_artwork_assignments"],
  "shared-platform": ["M0; Cross-module transaction policy", "v2_operation_requests v2_outbox_messages v2_principal_attributions"],
  billing: ["Billing", "invoices payments v2_billing_invoice_additional_charges v2_billing_invoice_checkpoints v2_billing_invoice_lines v2_billing_invoice_revisions v2_billing_invoices v2_billing_payment_allocations v2_billing_payments v2_billing_provider_events v2_billing_provider_financial_operations v2_billing_refund_allocation_evidence v2_billing_refund_allocations v2_billing_refunds"],
  fulfillment: ["Decision 3; Fulfillment", "v2_fulfillment_handoff_document_snapshots v2_fulfillment_handoff_lines v2_fulfillment_handoffs v2_order_replacement_obligation_events v2_order_replacement_obligations"],
  shipping: ["Decision 2; Shipping", "v2_fulfillment_shipment_actual_cost_updates v2_fulfillment_shipment_economics_events v2_fulfillment_shipment_events v2_fulfillment_shipment_handoffs v2_fulfillment_shipment_prepared_revision_lines v2_fulfillment_shipment_prepared_revisions v2_fulfillment_shipment_shipping_allocations v2_fulfillment_shipments v2_shipping_pricing_policies v2_shipping_pricing_policy_events"],
  inbound: ["Inbound Orders", "v2_inbound_intake_events v2_inbound_intakes"],
  communications: ["Communications", "v2_invoice_email_delivery_batches v2_invoice_email_delivery_items v2_invoice_email_delivery_jobs v2_invoice_email_delivery_rate_limits"],
  sales: ["Sales; Decision C persisted TEMP workspace", "orders quotes v2_order_line_material_requirements v2_sales_document_lines v2_sales_documents v2_sales_line_production_requirements v2_sales_line_workflow_exceptions v2_sales_order_details v2_sales_quote_checkpoints v2_sales_quote_conversions v2_sales_quote_delivery_attempts v2_sales_quote_details v2_sales_workspaces v2_sales_workspace_lines v2_sales_workspace_requests v2_sales_workspace_promotions v2_sales_workspace_promotion_lines"],
  prepress: ["Prepress", "v2_prepress_units"],
  production: ["Production", "v2_production_attempts v2_production_material_consumptions v2_production_output_dispositions v2_production_rework_cycles v2_production_run_allocations v2_production_run_events v2_production_runs v2_production_work_events v2_production_works"],
  proofing: ["Artwork; Prepress; Known boundary debt BD-4 proof/delivery facts", "v2_proof_responses v2_proof_version_artwork v2_proof_versions v2_proof_works"],
  routing: ["Routing", "v2_route_instance_steps v2_route_instances v2_route_template_production_destinations v2_route_template_steps v2_route_templates"],
};
export const tableOwners = Object.fromEntries(Object.entries(groups).flatMap(([owner, [section, tables]]) =>
  tables.split(" ").map((table) => [table, { owner, reference: `${doc} §${section}` }])));

// Exact hosted code areas. Other adapters use their declared infrastructure area;
// permission administration under organization remains Settings -> Auth debt.
export const writerAreas = {
  "infrastructure/fulfillment/postgresShipmentContainerTransaction.ts": "shipping",
  "infrastructure/fulfillment/postgresShippingEconomics.ts": "shipping",
  "infrastructure/fulfillment/postgresShipmentShippingAllocation.ts": "shipping",
  "infrastructure/fulfillment/postgresShipmentEconomicsRead.ts": "shipping",
  "infrastructure/billing/stripeConnectAccounts.ts": "integrations",
  "infrastructure/billing/stripeProviderIngress.ts": "integrations",
  "infrastructure/billing/stripePaymentInitiation.ts": "integrations",
  "infrastructure/communications/postgresEmailIntegration.ts": "integrations",
  "infrastructure/sales/postgresSalesTaxSettings.ts": "settings",
};

// BD-4's minimum correction assigns only proof-recipient authority binding to
// Auth's bounded operation. Portal lifecycle ownership (BDR-3) remains deferred;
// other files, operations, and deletion receive no permission from this map.
// The legacy physical-home check still requires exact compatibility evidence.
export const operationTableOwners = {
  "infrastructure/authorization/postgresProofRecipientAccess.ts": {
    customer_portal_access: {
      owner: "authentication",
      verbs: ["INSERT", "UPDATE"],
      reference: `${doc} §Authentication / Permissions; Known boundary debt BD-4 target; BDR-3 lifecycle remains unresolved`,
    },
  },
};
