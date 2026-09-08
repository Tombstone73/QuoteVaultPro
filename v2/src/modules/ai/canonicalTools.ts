import type { Capability } from "../../authorization/capabilities.js";
import type { DelegatedAiPrincipal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { AiCommandHandler } from "./assistantApplication.js";
import type { AiExecutionContext, AiPreparedCommand, AiToolDefinition } from "./contracts.js";

/**
 * V2's model-facing adapters are intentionally ports.  Runtime composition
 * supplies canonical application/read services; this module has no Drizzle,
 * HTTP, storage, provider, or legacy-assistant dependency.
 */
export type AiSafeSummary = Readonly<{ id: string; label: string; status?: string; reference?: string; detail?: string }>;
export type AiPage = Readonly<{ items: readonly AiSafeSummary[]; nextCursor?: string }>;
/** A read port receives the server-issued staff identity.  It must never
 * accept a model-supplied tenant, customer, or staff identity. */
export type AiReadPort = Readonly<{ search(input: Readonly<{ context: AiExecutionContext; organizationId: string; query?: string; id?: string; cursor?: string; limit: number }>): Promise<AiPage> }>;

export type AiPricingPreviewInput = Readonly<{ customerId: string; productId: string; quantity: number; selections?: Readonly<Record<string, unknown>>; dimensions?: Readonly<Record<string, unknown>> }>;
export type AiPricingPreviewPort = Readonly<{ preview(input: Readonly<{ context: AiExecutionContext; organizationId: string; request: AiPricingPreviewInput }>): Promise<AiPage> }>;

const boundedSearch = (raw: unknown): Readonly<{ query?: string; id?: string; cursor?: string; limit: number }> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new V2ApplicationError("VALIDATION_ERROR", "AI tool input must be an object.");
  const value = raw as Record<string, unknown>;
  const string = (name: string, max: number): string | undefined => value[name] === undefined ? undefined : typeof value[name] === "string" && value[name].trim().length > 0 && value[name].length <= max ? value[name].trim() : undefined;
  const query = string("query", 160); const id = string("id", 128); const cursor = string("cursor", 512);
  if (value.query !== undefined && !query) throw new V2ApplicationError("VALIDATION_ERROR", "Search text is invalid.");
  if (value.id !== undefined && !id) throw new V2ApplicationError("VALIDATION_ERROR", "Entity identity is invalid.");
  const limit = value.limit === undefined ? 25 : value.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) throw new V2ApplicationError("VALIDATION_ERROR", "Result limit must be between 1 and 50.");
  return Object.freeze({ ...(query ? { query } : {}), ...(id ? { id } : {}), ...(cursor ? { cursor } : {}), limit: limit as number });
};

const boundedPricingPreview = (raw: unknown): AiPricingPreviewInput => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new V2ApplicationError("VALIDATION_ERROR", "Pricing preview input must be an object.");
  const value = raw as Record<string, unknown>;
  const id = (name: "customerId" | "productId") => typeof value[name] === "string" && value[name].trim().length > 0 && value[name].trim().length <= 128 ? value[name].trim() : undefined;
  const customerId = id("customerId"), productId = id("productId");
  if (!customerId || !productId || !Number.isSafeInteger(value.quantity) || (value.quantity as number) < 1 || (value.quantity as number) > 1_000_000)
    throw new V2ApplicationError("VALIDATION_ERROR", "Customer, Product, and a positive bounded quantity are required.");
  const object = (name: "selections" | "dimensions") => value[name] === undefined ? undefined : typeof value[name] === "object" && value[name] !== null && !Array.isArray(value[name]) ? value[name] as Readonly<Record<string, unknown>> : undefined;
  if ((value.selections !== undefined && !object("selections")) || (value.dimensions !== undefined && !object("dimensions"))) throw new V2ApplicationError("VALIDATION_ERROR", "Pricing configuration must be an object.");
  return Object.freeze({ customerId, productId, quantity: value.quantity as number, ...(object("selections") ? { selections: object("selections") } : {}), ...(object("dimensions") ? { dimensions: object("dimensions") } : {}) });
};

export type CanonicalAiReadPorts = Readonly<{
  customers: AiReadPort; customerActivity: AiReadPort; products: AiReadPort; quotes: AiReadPort; orders: AiReadPort; artwork: AiReadPort;
  proofs: AiReadPort; prepress: AiReadPort; production: AiReadPort; fulfillment: AiReadPort; invoices: AiReadPort;
  payments: AiReadPort; inbound: AiReadPort; pricingPreview: AiPricingPreviewPort;
}>;

const read = (name: string, description: string, capability: Capability, port: AiReadPort): AiToolDefinition<ReturnType<typeof boundedSearch>, AiPage> => ({
  name, description, kind: "read", capability, confirmationRequired: false, status: "available_read",
  parseInput: boundedSearch,
  execute: async (context, input) => port.search({ context: context as AiExecutionContext, organizationId: context.organizationId, ...input }),
});

/** Initial coverage is bounded, paginated, and safe to expose to a future model. */
export const canonicalAiReadDefinitions = (ports: CanonicalAiReadPorts): readonly AiToolDefinition<unknown, unknown>[] => {
  const pricing: AiToolDefinition<AiPricingPreviewInput, AiPage> = { name: "pricing.preview", description: "Request canonical customer/product pricing evidence; never calculate a price.", kind: "read", capability: "pricing.preview", confirmationRequired: false, status: "available_read", parseInput: boundedPricingPreview, execute: (context, request) => ports.pricingPreview.preview({ context: context as AiExecutionContext, organizationId: context.organizationId, request }) };
  return Object.freeze([
  read("customer.search", "Find customer and contact summaries.", "customer.view", ports.customers),
  read("customer.activity", "Inspect a bounded canonical customer activity timeline by exact customer ID.", "customer.view", ports.customerActivity),
  read("product.search", "Find purchasable product summaries and configuration availability.", "product.view", ports.products),
  read("quote.search", "Find quote status summaries.", "quote.view", ports.quotes),
  read("order.search", "Find order workflow, production, fulfillment, and billing summaries.", "order.view", ports.orders),
  read("artwork.search", "Inspect order artwork metadata only.", "artwork.view", ports.artwork),
  read("proof.search", "Inspect proof approval and revision status.", "proof.view", ports.proofs),
  read("prepress.search", "Inspect prepress readiness and blockers.", "prepress.view", ports.prepress),
  read("production.search", "Inspect production job and station progress.", "production.view", ports.production),
  read("fulfillment.search", "Inspect remaining fulfillment, pickup, shipment, and tracking state.", "fulfillment.view", ports.fulfillment),
  read("invoice.search", "Inspect invoice balance and settlement state.", "payment.view", ports.invoices),
  read("payment.search", "Inspect payment and refund history; this remains read-only.", "payment.view", ports.payments),
  read("inbound.search", "Inspect bounded inbound-intake queue status.", "inbound.view", ports.inbound),
  pricing,
  ]) as unknown as readonly AiToolDefinition<unknown, unknown>[];
};

export type CanonicalAiCommandPort = Readonly<{
  prepare(input: Readonly<{ context: AiExecutionContext; input: unknown }>): Promise<AiPreparedCommand>;
  execute(input: Readonly<{ organizationId: string; userId: string; conversationId: string; businessRequestId: string; delegatedPrincipal: DelegatedAiPrincipal; input: unknown }>): Promise<unknown>;
}>;
export type CanonicalAiCommandPorts = Readonly<{
  createCustomer: CanonicalAiCommandPort; addContact: CanonicalAiCommandPort; createOrder: CanonicalAiCommandPort;
  updateOrderHeader: CanonicalAiCommandPort; addOrderNote: CanonicalAiCommandPort; sendToPrepress: CanonicalAiCommandPort;
  sendToProduction: CanonicalAiCommandPort; productionNotRequired: CanonicalAiCommandPort;
}>;

const command = (name: string, capability: Capability, port: CanonicalAiCommandPort): AiCommandHandler => ({
  name, capability,
  prepare: (context, input) => port.prepare({ context, input }),
  execute: (context, input) => port.execute({ ...context, input }),
});

/** Every write delegates to the existing canonical application operation. */
export const canonicalAiCommandHandlers = (ports: CanonicalAiCommandPorts): readonly AiCommandHandler[] => Object.freeze([
  command("customer.create", "customer.edit", ports.createCustomer),
  command("contact.add", "customer.edit", ports.addContact),
  command("order.create", "order.create", ports.createOrder),
  command("order.update_header", "order.edit", ports.updateOrderHeader),
  command("order.add_note", "order.edit", ports.addOrderNote),
  command("order.send_to_prepress", "prepress.work", ports.sendToPrepress),
  command("order.send_to_production", "production.work", ports.sendToProduction),
  command("order.production_not_required", "order.edit", ports.productionNotRequired),
]);
