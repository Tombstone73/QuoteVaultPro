import { and, eq } from "drizzle-orm";
import { customerContacts, customers, products } from "@shared/schema";
import { db } from "../../db";
import { inspectProductPricing } from "../pricing/PricingService";
import { quoteDraftIntakeService } from "./quoteDraftIntakeService";
import { quoteCreateRequestSchema, createInputSchema } from "./quoteApplicationContract";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";

export function createQuoteApplicationTools(): AssistantOperatorSemanticTool[] {
  return [{
    name: "quotes.inspect_configuration",
    description: "Read current tenant Customer contacts and active Product Quote options before preparing a Quote. Supply a customerId and/or productId resolved from search. Returns supported PBV2 selection keys, choices, defaults, measurement mode, and contact IDs; it changes nothing.",
    inputSchema: { type: "object", additionalProperties: false, properties: { customerId: { type: "string" }, productId: { type: "string" } } },
    execute: async ({ arguments: args, context }) => {
      if (Object.keys(args).some((key) => key !== "customerId" && key !== "productId") || !args.customerId && !args.productId) return { status: "rejected", warning: "Supply a resolved customerId or productId." };
      const organizationId = context.scope.organizationId;
      const [customer] = typeof args.customerId === "string" ? await db.select({ id: customers.id, companyName: customers.companyName }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, args.customerId))).limit(1) : [];
      const [product] = typeof args.productId === "string" ? await db.select({ id: products.id, name: products.name, measurementMode: products.measurementMode, isActive: products.isActive }).from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, args.productId))).limit(1) : [];
      if (args.customerId && !customer || args.productId && (!product || !product.isActive)) return { status: "rejected", warning: "The requested Customer or active Product is not available in this organization." };
      const contacts = customer ? await db.select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName }).from(customerContacts).where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.customerId, customer.id))) : [];
      const pricing = product ? await inspectProductPricing({ organizationId, productId: product.id }) : null;
      return { status: "succeeded", result: { status: "succeeded", data: { customer: customer ?? null, contacts, product: product ? { id: product.id, name: product.name, measurementMode: product.measurementMode, pricing } : null }, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } } };
    },
  }, {
    name: "quotes.prepare_create",
    description: "Prepare one NEW draft Quote through staff Quote pricing and the protected GO execution command. Supply all known header, customer/contact, PO reference, seven or other line configurations, dimensions, quantities, and optional manual total prices. This saves only a review proposal; no Quote is created until GO. Never target an existing Quote as a fallback.",
    inputSchema: createInputSchema as unknown as Record<string, unknown>,
    execute: async ({ arguments: args, context }) => {
      const parsed = quoteCreateRequestSchema.safeParse(args);
      if (!parsed.success) return { status: "rejected", failureCategory: "argument_validation", failureCode: "quote_create_arguments_invalid", warning: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 1000) };
      try {
        const prepared = await quoteDraftIntakeService.prepareStructuredCreate({ organizationId: context.scope.organizationId, userId: context.actor.userId, conversationId: context.conversationId, request: parsed.data });
        return { status: "succeeded", result: { status: "succeeded", data: { response: prepared.response, taskDomain: "quotes", preview: prepared.cards[0]?.details }, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } }, presentation: { cards: prepared.cards as any } };
      } catch (error) { return { status: "rejected", failureCategory: "business_validation", failureCode: error && typeof error === "object" && "code" in error ? String(error.code) : "quote_preparation_failed", warning: error instanceof Error ? error.message : "Quote preparation failed." }; }
    },
  }];
}
