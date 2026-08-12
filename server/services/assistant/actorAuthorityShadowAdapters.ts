/**
 * Phase 2A legacy adapters. These are exact extractions of the existing
 * route-local grants, retained only to make shadow comparison observable.
 * They are not an authority source and must never be consumed by the resolver.
 */
const internalRoles = new Set(["owner", "admin", "manager", "member", "employee"]);

export function normalizeAssistantOrganizationRole(role: unknown): string {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

export function legacyChatPermissionsForOrganizationRole(role: unknown): readonly string[] {
  const normalized = normalizeAssistantOrganizationRole(role);
  if (!internalRoles.has(normalized)) return [];
  return [
    "assistant.internal_staff", "catalog.read", "assistant.quotes.add_internal_note",
    ...(normalized === "owner" || normalized === "admin" ? [
      "assistant.products.create_inactive_draft", "assistant.products.update_inactive_draft",
      "assistant.products.update_existing_product", "assistant.diagnostics.view", "finance.read",
    ] : []),
  ];
}

export function legacyExecutionSyntheticPermissionsForOrganizationRole(role: unknown): readonly string[] {
  const normalized = normalizeAssistantOrganizationRole(role);
  if (!internalRoles.has(normalized)) return [];
  return [
    "assistant.internal_staff", "catalog.read", "assistant.quotes.add_internal_note",
    "assistant.quotes.create_draft", "assistant.quotes.update_draft", "assistant.orders.create",
    "assistant.orders.update_editable", "assistant.quotes.convert_to_order", "assistant.customers.create",
    "assistant.customers.update_profile", "assistant.customers.update_commercial_terms", "assistant.contacts.create",
    "assistant.contacts.update", "assistant.production.intake_line_items", "assistant.production.send_to_prepress",
    "assistant.production.update_job_status", "assistant.production.add_job_note", "assistant.fulfillment.create_shipment",
    "assistant.fulfillment.update_shipment_details", "assistant.fulfillment.mark_shipped",
    "assistant.fulfillment.create_pickup_ticket", "assistant.fulfillment.add_note", "assistant.billing.create_invoice",
    "assistant.billing.update_invoice_draft", "assistant.billing.send_invoice", "assistant.billing.add_invoice_note",
    "assistant.payments.record_manual_payment", "assistant.payments.add_payment_note",
    ...(normalized === "owner" || normalized === "admin" ? [
      "assistant.products.create_inactive_draft", "assistant.products.create_inactive_draft_batch",
      "assistant.products.update_inactive_draft", "assistant.products.update_inactive_draft_batch",
      "assistant.products.update_existing_product", "assistant.products.adjust_pricing",
      "assistant.products.clone_to_inactive_draft", "assistant.products.replace_inactive_matrix",
      "assistant.products.replace_inactive_quantity_tiers",
    ] : []),
  ];
}
