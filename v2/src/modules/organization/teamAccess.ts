import { isCapability, type Capability } from "../../authorization/capabilities.js";
import { V2ApplicationError } from "../../errors/applicationError.js";

export type TeamCapabilityPresentation = Readonly<{ id: Capability; label: string; description?: string; sensitive: boolean }>;
export type TeamCapabilityGroup = Readonly<{ key: string; label: string; capabilities: readonly TeamCapabilityPresentation[] }>;

const sensitiveCapabilities = new Set<Capability>([
  "organization.configure", "numbering.configure", "communications.configure", "pricing.configure", "pricing.publish",
  "payment.record", "refund.issue", "permissions.manageSets", "permissions.assignStaff", "permissions.assignPortal",
  "route.manageTemplates", "workflow.override",
]);

const capabilityLabels: Readonly<Record<Capability, string>> = {
  "quote.view": "View quotes", "quote.create": "Create quotes", "quote.edit": "Edit quotes", "quote.send": "Send quotes", "quote.convert": "Convert quotes", "quote.overridePrice": "Override quote price",
  "order.view": "View orders", "order.create": "Create orders", "order.edit": "Edit orders", "order.cancel": "Cancel orders", "order.overridePrice": "Override order price",
  "customer.view": "View customers", "customer.edit": "Edit customers", "product.view": "View products", "product.edit": "Edit products",
  "organization.configure": "Configure organization", "numbering.configure": "Configure document numbering", "communications.configure": "Configure communications",
  "pricing.preview": "Preview pricing", "pricing.configure": "Configure pricing", "pricing.publish": "Publish pricing",
  "invoice.view": "View invoices", "invoice.editDraft": "Edit draft invoices", "invoice.editIssued": "Edit issued invoices", "invoice.issue": "Issue invoices", "invoice.send": "Send invoices",
  "payment.view": "View payments", "payment.record": "Record payments", "refund.issue": "Issue refunds",
  "permissions.view": "View roles and permissions", "permissions.manageSets": "Manage roles", "permissions.assignStaff": "Assign staff roles", "permissions.assignPortal": "Assign portal roles",
  "route.view": "View routing", "route.advance": "Advance routing", "route.reroute": "Reroute work", "route.skipStep": "Skip routing steps", "route.manageTemplates": "Manage route templates",
  "workflow.override": "Override workflow", "artwork.view": "View artwork", "artwork.adopt": "Upload and adopt artwork", "artwork.assign": "Assign or remove artwork",
  "proof.view": "View proofs", "proof.prepare": "Prepare proofs", "proof.issue": "Issue proofs", "proof.respond": "Respond to proofs",
  "fulfillment.view": "View fulfillment", "fulfillment.pickup": "Complete pickup", "fulfillment.ship": "Ship orders", "fulfillment.replace": "Create replacements", "fulfillment.shipping.cost": "Record shipping cost", "fulfillment.shipping.price": "Set shipping price",
  "prepress.view": "View prepress", "prepress.work": "Work prepress", "prepress.complete": "Complete prepress",
  "production.view": "View production", "production.work": "Work production", "production.complete": "Complete production", "production.hold": "Hold production", "production.rework": "Request rework", "production.note": "Add production notes", "production.output.reject": "Reject production output", "production.run.create": "Create production runs", "production.run.execute": "Execute production runs",
  "inventory.view": "View inventory", "inventory.receive": "Receive inventory", "inbound.view": "View inbound work", "inbound.review": "Review inbound work", "assistant.use": "Use AI assistant",
};

const capabilityDescriptions: Partial<Record<Capability, string>> = {
  "payment.record": "Create customer payment records; this does not grant refunds or provider configuration.",
  "refund.issue": "Issue customer refunds through the configured financial workflow.",
  "permissions.manageSets": "Create, clone, edit, and deactivate organization roles within your authority ceiling.",
  "permissions.assignStaff": "Assign one or more active Staff roles to organization members.",
  "organization.configure": "Change broad business and integration settings for this organization.",
  "pricing.publish": "Publish pricing changes that affect future commercial work.",
  "workflow.override": "Bypass a normal workflow transition when operationally justified.",
};

const present = (id: Capability): TeamCapabilityPresentation => Object.freeze({ id, label: capabilityLabels[id], description: capabilityDescriptions[id], sensitive: sensitiveCapabilities.has(id) });
const group = (key: string, label: string, capabilities: readonly Capability[]): TeamCapabilityGroup => Object.freeze({ key, label, capabilities: Object.freeze(capabilities.map(present)) });

/** Presentation metadata only. Capability IDs remain the single authority taxonomy. */
export const teamCapabilityGroups: readonly TeamCapabilityGroup[] = Object.freeze([
  group("customers", "Customers & Contacts", ["customer.view", "customer.edit"]),
  group("quotes", "Quotes", ["quote.view", "quote.create", "quote.edit", "quote.send", "quote.convert", "quote.overridePrice"]),
  group("orders", "Orders", ["order.view", "order.create", "order.edit", "order.cancel", "order.overridePrice"]),
  group("products", "Products", ["product.view", "product.edit"]),
  group("pricing", "Pricing", ["pricing.preview", "pricing.configure", "pricing.publish"]),
  group("artwork", "Artwork", ["artwork.view", "artwork.adopt", "artwork.assign"]),
  group("proofing", "Proofing", ["proof.view", "proof.prepare", "proof.issue", "proof.respond"]),
  group("prepress", "Prepress", ["prepress.view", "prepress.work", "prepress.complete"]),
  group("production", "Production", ["production.view", "production.work", "production.run.create", "production.run.execute", "production.complete", "production.hold", "production.note", "production.rework", "production.output.reject"]),
  group("fulfillment", "Fulfillment", ["fulfillment.view", "fulfillment.pickup", "fulfillment.ship", "fulfillment.replace", "fulfillment.shipping.cost", "fulfillment.shipping.price"]),
  group("invoices", "Invoices", ["invoice.view", "invoice.editDraft", "invoice.editIssued", "invoice.issue", "invoice.send"]),
  group("payments", "Payments", ["payment.view", "payment.record", "refund.issue"]),
  group("routing", "Routing", ["route.view", "route.advance", "route.reroute", "route.skipStep", "route.manageTemplates", "workflow.override"]),
  group("inventory", "Inventory", ["inventory.view", "inventory.receive"]),
  group("inbound", "Inbound", ["inbound.view", "inbound.review"]),
  group("communications", "Communications", ["communications.configure"]),
  group("organization", "Organization", ["organization.configure", "numbering.configure"]),
  group("permissions", "Permissions & Security", ["permissions.view", "permissions.manageSets", "permissions.assignStaff", "permissions.assignPortal"]),
  group("assistant", "Assistant", ["assistant.use"]),
]);

export const parseCapabilities = (value: unknown): readonly Capability[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !isCapability(item)))
    throw new V2ApplicationError("VALIDATION_ERROR", "Capabilities must be known capability IDs.");
  return [...new Set(value)].sort() as Capability[];
};

export const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
};

export const optionalString = (value: unknown, field: string, maximum = 500): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length > maximum) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return value.trim() || undefined;
};
