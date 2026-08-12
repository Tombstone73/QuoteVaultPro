/**
 * Server-owned, tenant-scoped organization-role authority policy.
 *
 * `tenantContext` establishes the persisted `userOrganizations.role`; this
 * module only normalizes that trusted fact. It never consumes claims supplied
 * by a provider, AI runtime, browser context, or an execution plan.
 *
 * Mutation grants are sourced from the production command definitions:
 * owner/admin product commands declare [owner, admin], while the reviewed
 * quote/order/CRM/production/fulfillment/billing/payment commands declare
 * [owner, admin, manager, employee]. A member has no such command metadata
 * grant and deliberately remains read-only for AI authority purposes.
 */
export const organizationRoleValues = ["owner", "admin", "manager", "member", "employee"] as const;
export type OrganizationRole = (typeof organizationRoleValues)[number];

export type OrganizationRoleAuthority = {
  role: OrganizationRole | null;
  grants: readonly string[];
  status: "resolved" | "unknown";
  sourceTrace: readonly string[];
};

const readGrants = ["assistant.internal_staff", "catalog.read"] as const;
const operationalMutationGrants = [
  "assistant.quotes.add_internal_note", "assistant.quotes.create_draft", "assistant.quotes.update_draft",
  "assistant.orders.create", "assistant.orders.update_editable", "assistant.quotes.convert_to_order",
  "assistant.customers.create", "assistant.customers.update_profile", "assistant.customers.update_commercial_terms",
  "assistant.contacts.create", "assistant.contacts.update", "assistant.production.intake_line_items",
  "assistant.production.send_to_prepress", "assistant.production.update_job_status", "assistant.production.add_job_note",
  "assistant.fulfillment.create_shipment", "assistant.fulfillment.update_shipment_details", "assistant.fulfillment.mark_shipped",
  "assistant.fulfillment.create_pickup_ticket", "assistant.fulfillment.add_note", "assistant.billing.create_invoice",
  "assistant.billing.update_invoice_draft", "assistant.billing.send_invoice", "assistant.billing.add_invoice_note",
  "assistant.payments.record_manual_payment", "assistant.payments.add_payment_note",
] as const;
const productMutationGrants = [
  "assistant.products.create_inactive_draft", "assistant.products.create_inactive_draft_batch",
  "assistant.products.update_inactive_draft", "assistant.products.update_inactive_draft_batch",
  "assistant.products.update_existing_product", "assistant.products.adjust_pricing",
  "assistant.products.clone_to_inactive_draft", "assistant.products.replace_inactive_matrix",
  "assistant.products.replace_inactive_quantity_tiers",
] as const;

function normalizedGrants(grants: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(grants)].sort());
}

export function normalizeOrganizationRole(role: unknown): OrganizationRole | null {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  return organizationRoleValues.includes(normalized as OrganizationRole) ? normalized as OrganizationRole : null;
}

export function resolveOrganizationRoleAuthority(role: unknown): OrganizationRoleAuthority {
  const normalized = normalizeOrganizationRole(role);
  if (!normalized) return {
    role: null, grants: [], status: "unknown",
    sourceTrace: ["userOrganizations.role", "organization_role_unmapped_or_missing"],
  };
  if (normalized === "member") return {
    role: normalized, grants: normalizedGrants(readGrants), status: "resolved",
    sourceTrace: ["userOrganizations.role", "organization_role_authority_policy", "member_read_only"],
  };
  if (normalized === "manager" || normalized === "employee") return {
    role: normalized, grants: normalizedGrants([...readGrants, ...operationalMutationGrants]), status: "resolved",
    sourceTrace: ["userOrganizations.role", "organization_role_authority_policy", "command.allowedRoles.operational"],
  };
  return {
    role: normalized,
    grants: normalizedGrants([...readGrants, ...operationalMutationGrants, ...productMutationGrants, "assistant.diagnostics.view", "finance.read"]),
    status: "resolved",
    sourceTrace: ["userOrganizations.role", "organization_role_authority_policy", "command.allowedRoles.operational_and_product"],
  };
}
