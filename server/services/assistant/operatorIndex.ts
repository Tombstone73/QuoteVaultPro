/**
 * Phase 3 Operator Index. It is deliberately concise, code-versioned
 * selection metadata. Phase 4 resolves only the selected, manifest-approved
 * knowledge into provider context; it never grants a capability or authority.
 */
export const operatorDomainValues = [
  "products", "pricing", "quotes", "orders", "proofing", "prepress", "production",
  "fulfillment", "invoicing", "payments", "customers_contacts", "materials",
  "settings_permissions", "public_research",
] as const;
export type OperatorDomain = (typeof operatorDomainValues)[number];

export const operatorCapabilityCategoryValues = ["read", "mutation", "pricing", "configuration", "lifecycle", "reporting", "research", "administration"] as const;
export type OperatorCapabilityCategory = (typeof operatorCapabilityCategoryValues)[number];

export type OperatorIndexEntry = {
  domain: OperatorDomain;
  purpose: string;
  selectionHints: readonly string[];
  relatedDomains: readonly OperatorDomain[];
  skillId: string;
  skillVersion: "v1";
  capabilityCategories: readonly OperatorCapabilityCategory[];
  contextHints?: readonly string[];
};

export const operatorIndex = Object.freeze([
  { domain: "products", purpose: "Product definitions, configuration, options, measurement modes, and product lifecycle.", selectionHints: ["product", "catalog", "option", "measurement"], relatedDomains: ["pricing", "materials", "proofing", "production"], skillId: "products.pbv2", skillVersion: "v1", capabilityCategories: ["read", "configuration", "lifecycle"] },
  { domain: "pricing", purpose: "PBV2 pricing, matrices, tiers, rates, and pricing change sets.", selectionHints: ["price", "pricing", "matrix", "tier", "pbv2"], relatedDomains: ["products", "quotes", "materials"], skillId: "pricing.pbv2", skillVersion: "v1", capabilityCategories: ["read", "pricing", "configuration"] },
  { domain: "quotes", purpose: "Quote drafting, editing, conversion, and internal quote notes.", selectionHints: ["quote", "estimate"], relatedDomains: ["orders", "customers_contacts", "pricing"], skillId: "quotes.operations", skillVersion: "v1", capabilityCategories: ["read", "mutation"] },
  { domain: "orders", purpose: "Order creation, editable-order updates, and order lifecycle context.", selectionHints: ["order", "job"], relatedDomains: ["quotes", "production", "fulfillment"], skillId: "orders.operations", skillVersion: "v1", capabilityCategories: ["read", "mutation", "lifecycle"] },
  { domain: "proofing", purpose: "Proof requirements and proof-related operating knowledge.", selectionHints: ["proof", "approval"], relatedDomains: ["products", "prepress", "production"], skillId: "proofing.operations", skillVersion: "v1", capabilityCategories: ["read", "lifecycle"] },
  { domain: "prepress", purpose: "Prepress preparation, files, and workflow context.", selectionHints: ["prepress", "artwork", "file"], relatedDomains: ["proofing", "production", "orders"], skillId: "prepress.operations", skillVersion: "v1", capabilityCategories: ["read", "lifecycle"] },
  { domain: "production", purpose: "Production intake, queue operations, job status, and internal notes.", selectionHints: ["production", "queue", "flatbed", "job status"], relatedDomains: ["orders", "prepress", "fulfillment"], skillId: "production.operations", skillVersion: "v1", capabilityCategories: ["read", "mutation", "reporting"] },
  { domain: "fulfillment", purpose: "Shipments, pickup tickets, shipping status, and fulfillment notes.", selectionHints: ["ship", "shipment", "pickup", "fulfillment"], relatedDomains: ["orders", "production", "invoicing"], skillId: "fulfillment.operations", skillVersion: "v1", capabilityCategories: ["mutation", "lifecycle"] },
  { domain: "invoicing", purpose: "Invoice creation, drafts, sending, and invoice notes.", selectionHints: ["invoice", "billing"], relatedDomains: ["payments", "orders", "customers_contacts"], skillId: "invoicing.operations", skillVersion: "v1", capabilityCategories: ["mutation", "reporting"] },
  { domain: "payments", purpose: "Manual payment recording and payment notes.", selectionHints: ["payment", "paid", "receipt"], relatedDomains: ["invoicing", "customers_contacts"], skillId: "payments.operations", skillVersion: "v1", capabilityCategories: ["mutation", "reporting"] },
  { domain: "customers_contacts", purpose: "Customer profiles, commercial terms, contacts, and customer analysis.", selectionHints: ["customer", "contact", "client"], relatedDomains: ["quotes", "orders", "invoicing", "payments"], skillId: "customers.contacts", skillVersion: "v1", capabilityCategories: ["read", "mutation", "reporting"] },
  { domain: "materials", purpose: "Material selection, inventory, and supplier-related operating context.", selectionHints: ["material", "substrate", "inventory", "stock"], relatedDomains: ["products", "pricing", "production"], skillId: "materials.operations", skillVersion: "v1", capabilityCategories: ["read", "configuration"] },
  { domain: "settings_permissions", purpose: "Organization settings and permission concepts; AI policy controls remain unavailable.", selectionHints: ["setting", "permission", "organization"], relatedDomains: ["products"], skillId: "settings.permissions", skillVersion: "v1", capabilityCategories: ["read", "administration"] },
  { domain: "public_research", purpose: "Public research that remains separate from tenant business authority and persistence references.", selectionHints: ["research", "supplier", "public web"], relatedDomains: ["products", "materials"], skillId: "research.public", skillVersion: "v1", capabilityCategories: ["research"] },
] as const satisfies readonly OperatorIndexEntry[]);

export function selectOperatorDomains(text: string): readonly OperatorIndexEntry[] {
  const normalized = text.toLowerCase();
  return operatorIndex.filter((entry) => entry.selectionHints.some((hint) => normalized.includes(hint)));
}

export function renderOperatorIndexMarkdown(): string {
  const rows = operatorIndex.map((entry) => `| ${entry.domain} | ${entry.skillId}@${entry.skillVersion} | ${entry.relatedDomains.join(", ")} | ${entry.capabilityCategories.join(", ")} | ${entry.purpose} |`).join("\n");
  return `# AI Operator Index\n\n> Generated from \`server/services/assistant/operatorIndex.ts\`. It selects domain metadata for bounded, manifest-approved operating knowledge. It never grants capabilities or authority.\n\n| Domain | Skill | Related domains | Capability categories | Purpose |\n|---|---|---|---|---|\n${rows}\n`;
}
