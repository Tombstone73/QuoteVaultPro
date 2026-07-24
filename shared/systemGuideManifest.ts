/**
 * Canonical, versioned metadata used by the read-only System Guide.  This is
 * deliberately authored from registered application metadata instead of
 * scraping source files or the browser DOM at request time.
 */
export const SYSTEM_GUIDE_MANIFEST_VERSION = "2026-07-23.1";

export const systemGuideRoutes = [
  { pattern: "/quotes", label: "Quotes", category: "Quotes", summary: "Create, price, revise, send, and convert customer quotes.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/quotes/:id", label: "Quote detail", category: "Quotes", summary: "Review a quote, its line items, pricing, and customer-facing lifecycle.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/orders/:id", label: "Order detail", category: "Orders", summary: "Manage order line items, artwork, workflow, production, fulfillment, and billing context.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/prepress", label: "Prepress", category: "Prepress", summary: "Review artwork readiness and advance eligible production work.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/production", label: "Production Board", category: "Production", summary: "View and work station-managed production jobs.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/fulfillment", label: "Fulfillment", category: "Fulfillment", summary: "Prepare completed work for pickup, delivery, or shipment.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/invoices", label: "Invoices", category: "Invoicing", summary: "Review invoice candidates, invoices, payments, and billing state.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/products", label: "Products", category: "Products", summary: "Manage products, routing defaults, and PBV2 configuration.", roles: ["owner", "admin", "manager", "employee"] },
  { pattern: "/settings/ai", label: "AI Settings", category: "Organization settings", summary: "Configure approved AI provider and assistant availability.", roles: ["owner", "admin"] },
  { pattern: "/settings", label: "Settings", category: "Organization settings", summary: "Configure organization-level operational settings.", roles: ["owner", "admin"] },
] as const;

export const systemGuideCapabilities = {
  workflowExplanations: true,
  screenSpecificHelp: true,
  statusAndPermissionExplanations: true,
  recordSpecificDiagnosis: true,
  knowledgeSourceCitations: true,
  externalResearch: false,
  mcp: false,
  productionBusinessMutations: 0,
} as const;

export const systemGuideStatusLabels = {
  new: "New",
  needs_design: "Needs design",
  awaiting_proof_approval: "Awaiting proof approval",
  ready_for_prepress: "Ready for Prepress",
  in_prepress: "In Prepress",
  ready_for_production: "Print Ready",
  in_production: "In production",
  completed: "Completed",
  no_production_required: "No production required",
} as const;

export function systemGuideRouteFor(path: string) {
  const normalized = path.replace(/\/[A-Za-z0-9_-]{1,128}(?:\/edit)?$/, "/:id");
  return systemGuideRoutes.find((route) => route.pattern === path || route.pattern === normalized)
    ?? systemGuideRoutes.find((route) => path.startsWith(route.pattern));
}
