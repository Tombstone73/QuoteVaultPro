import { isCapability, type Capability } from "../../authorization/capabilities.js";
import { V2ApplicationError } from "../../errors/applicationError.js";

export type TeamCapabilityGroup = Readonly<{ key: string; label: string; capabilities: readonly Capability[] }>;

/** Presentation metadata only. Capability IDs remain the single authority taxonomy. */
export const teamCapabilityGroups: readonly TeamCapabilityGroup[] = [
  { key: "sales", label: "Sales", capabilities: ["quote.view", "quote.create", "quote.edit", "quote.send", "quote.convert", "quote.overridePrice", "order.view", "order.create", "order.edit", "order.cancel", "order.overridePrice"] },
  { key: "customers", label: "Customers", capabilities: ["customer.view", "customer.edit"] },
  { key: "products_pricing", label: "Products & Pricing", capabilities: ["product.view", "product.edit", "pricing.preview", "pricing.configure", "pricing.publish"] },
  { key: "routing_production", label: "Routing & Production", capabilities: ["route.view", "route.advance", "route.reroute", "route.skipStep", "route.manageTemplates", "artwork.view", "artwork.adopt", "artwork.assign", "proof.view", "proof.prepare", "proof.issue", "proof.respond", "prepress.view", "prepress.work", "prepress.complete", "production.view", "production.work", "production.complete", "inventory.view", "inventory.receive"] },
  { key: "fulfillment", label: "Fulfillment", capabilities: ["fulfillment.view", "fulfillment.pickup", "fulfillment.ship"] },
  { key: "billing", label: "Billing", capabilities: ["invoice.view", "invoice.editDraft", "invoice.editIssued", "invoice.issue", "payment.view", "payment.record", "refund.issue"] },
  { key: "settings", label: "Settings & Access", capabilities: ["organization.configure", "communications.configure", "permissions.view", "permissions.manageSets", "permissions.assignStaff", "permissions.assignPortal"] },
];

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
