/**
 * R0266 restores Routing identity and the early, Draft-only Billing surface.
 * It does not create provider operations, call providers, or infer legacy
 * route, invoice, payment, or tax state.  The executor must use it only after
 * R0265 is attested and must make the listed immutable source SQL a single
 * stage transaction.
 */
import type { ReconciliationStageDefinition } from "./types.js";

export const r0266RoutingBilling: ReconciliationStageDefinition = {
  id: "R0266",
  label: "Routing and billing physical foundation",
  migrationFiles: [
    "0193_v2_routing_identity_foundation.sql",
    "0194_v2_route_completed_current_step_repair.sql",
  ],
  postconditions: [
    { kind: "table", name: "route-templates", table: "v2_route_templates", description: "Canonical tenant route templates exist." },
    { kind: "table", name: "route-template-steps", table: "v2_route_template_steps", description: "Route template step identity exists." },
    { kind: "table", name: "route-instances", table: "v2_route_instances", description: "Frozen route instance identity exists." },
    { kind: "table", name: "route-instance-steps", table: "v2_route_instance_steps", description: "Frozen route instance step identity exists." },
    { kind: "table", name: "billing-invoices", table: "v2_billing_invoices", description: "Draft-only V2 Invoice relation exists." },
    { kind: "table", name: "billing-invoice-lines", table: "v2_billing_invoice_lines", description: "Draft Invoice line relation exists." },
    { kind: "column", name: "product-routing-mode", table: "product_types", column: "routing_mode", expected: "unconfigured|no_route|route_required", description: "Legacy product types remain explicitly unconfigured by default." },
    { kind: "column", name: "product-default-route-template", table: "product_types", column: "default_route_template_id", expected: "nullable varchar", description: "A product type can name a tenant route template only under the policy constraint." },
    { kind: "column", name: "route-current-step-nullable", table: "v2_route_instances", column: "current_step_id", expected: "nullable varchar", description: "Completed routes have no current step." },
    { kind: "constraint", name: "routing-policy", table: "product_types", expected: "product_types_routing_policy_chk", description: "Route-required product types must name a route and legacy types are not guessed." },
    { kind: "constraint", name: "route-current-step", table: "v2_route_instances", expected: "v2_route_instances_current_step_instance_fk", description: "The current step points to the same durable route instance." },
    { kind: "constraint", name: "route-order", table: "v2_route_instances", expected: "v2_route_instances_order_tenant_fk", description: "Routes link to tenant-scoped V2 Orders." },
    { kind: "constraint", name: "route-order-line", table: "v2_route_instances", expected: "v2_route_instances_order_line_tenant_fk", description: "Routes link to tenant-scoped V2 Order lines." },
    { kind: "constraint", name: "invoice-order", table: "v2_billing_invoices", expected: "v2_billing_invoices_order_tenant_fk", description: "Invoices link to tenant-scoped V2 Orders." },
    { kind: "constraint", name: "invoice-total", table: "v2_billing_invoices", expected: "v2_billing_invoices_total_chk", description: "Invoice totals remain integer-cents arithmetic." },
    { kind: "constraint", name: "invoice-line-source", table: "v2_billing_invoice_lines", expected: "v2_billing_invoice_lines_source_sales_line_tenant_fk", description: "Invoice lines link to their tenant-scoped Sales source line." },
    { kind: "index", name: "route-template-name", table: "v2_route_templates", expected: "v2_route_templates_org_name_uidx", description: "Tenant route-template names are unique." },
    { kind: "index", name: "route-instance-work", table: "v2_route_instances", expected: "v2_route_instances_org_work_uidx", description: "One route exists per tenant work item." },
    { kind: "index", name: "invoice-one-draft", table: "v2_billing_invoices", expected: "v2_billing_invoices_one_draft_per_order_uidx", description: "An Order has at most one current Draft Invoice." },
    { kind: "index", name: "invoice-line-position", table: "v2_billing_invoice_lines", expected: "v2_billing_invoice_lines_invoice_position_uidx", description: "Invoice line positions are retry-safe." },
    { kind: "query", name: "no-automatic-v1-routing-billing-import", query: "SELECT NOT EXISTS (SELECT 1 FROM v2_route_instances) AND NOT EXISTS (SELECT 1 FROM v2_billing_invoices) AND NOT EXISTS (SELECT 1 FROM v2_billing_invoice_lines)", description: "R0266 creates no inferred V2 route or Billing facts from legacy rows." },
  ],
  legacyDataPolicy: "DDL only; the executor isolates M0195 billing DDL and reserves all authority seeding for R0268. Do not copy V1 routes, invoices, payments, refunds, provider identities, or tax data: legacy state does not prove V2 route snapshots, Billing lifecycle, or tax evidence. Never infer routing requirements, document numbering, invoice/payment/refund state, provider identity, or tax evidence.",
};
