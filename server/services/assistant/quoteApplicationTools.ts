import { and, eq } from "drizzle-orm";
import { customerContacts, customers, products } from "@shared/schema";
import { db } from "../../db";
import { inspectProductPricing } from "../pricing/PricingService";
import { quoteDraftIntakeService } from "./quoteDraftIntakeService";
import { quoteCreateRequestSchema, createInputSchema } from "./quoteApplicationContract";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";
import { quoteEditorOperationService, quoteEditorRequestSchema } from "./quoteEditorOperationService";
import { storage } from "../../storage";

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

const editorLineProperties = {
  productId: { type: "string", description: "Active Product ID from tenant search." },
  width: { type: "number", exclusiveMinimum: 0, description: "Finished width in inches; 1 for quantity-only Products." },
  height: { type: "number", exclusiveMinimum: 0 }, quantity: { type: "integer", minimum: 1 },
  optionSelections: { type: "object", description: "PBV2 option keys and values returned by quotes.inspect_configuration." },
  description: { type: ["string", "null"] }, productionNotes: { type: ["string", "null"] },
  status: { enum: ["active", "canceled"] }, requiresDesign: { type: "boolean" },
  requiresPrepress: { type: ["boolean", "null"] }, requiresProofApproval: { type: ["boolean", "null"] },
  displayOrder: { type: "integer" }, manualTotalCents: { type: "integer", minimum: 0, description: "Explicit staff total price override for this line." },
  manualPriceReason: { type: "string", description: "Required with manualTotalCents." }, clearManualPrice: { type: "boolean" },
} as const;
const { status: _createStatus, clearManualPrice: _createClearManualPrice, ...editorCreateLineProperties } = editorLineProperties;

export const quoteEditorInputSchema = {
  type: "object", additionalProperties: false, required: ["quoteId"], properties: {
    quoteId: { type: "string", description: "Exact editable draft Quote ID returned by quotes.search or quotes.get_detail." },
    header: { type: "object", additionalProperties: false, description: "Only include fields the user asked to change. PO reference is stored in label; this editor has no dedicated PO column or valid-until edit.", properties: {
      customerId: { type: ["string", "null"] }, contactId: { type: ["string", "null"] }, label: { type: ["string", "null"] },
      requestedDueDate: { type: ["string", "null"], format: "date-time" }, customerNotes: { type: ["string", "null"] },
      shippingInstructions: { type: ["string", "null"] }, shippingMethod: { enum: ["pickup", "ship", "deliver"] },
      shippingCents: { type: ["integer", "null"] }, discountAmount: { type: "number", minimum: 0 }, taxRate: { type: "number", minimum: 0, maximum: 1 },
      visibleInCustomerPortal: { type: "boolean" }, tags: { type: "array", items: { type: "string" } },
      shipToCompany: { type: ["string", "null"] }, shipToName: { type: ["string", "null"] }, shipToEmail: { type: ["string", "null"] }, shipToPhone: { type: ["string", "null"] },
      shipToAddress1: { type: ["string", "null"] }, shipToAddress2: { type: ["string", "null"] }, shipToCity: { type: ["string", "null"] },
      shipToState: { type: ["string", "null"] }, shipToPostalCode: { type: ["string", "null"] }, shipToCountry: { type: ["string", "null"] },
    } },
    lines: { type: "object", additionalProperties: false, description: "Changes only. Untouched lines are preserved.", properties: {
      update: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "changes"], properties: { id: { type: "string" }, changes: { type: "object", additionalProperties: false, properties: editorLineProperties } } } },
      create: { type: "array", items: { type: "object", additionalProperties: false, required: ["productId", "width", "height", "quantity"], properties: editorCreateLineProperties } },
      delete: { type: "array", items: { type: "string" } },
    } },
  },
} as const;

export function createQuoteEditorApplicationTools(): AssistantOperatorSemanticTool[] {
  return [{
    name: "quotes.inspect_editor",
    description: "Read one tenant-scoped existing Quote's editable header, revision, line IDs, Product configurations, dimensions, quantities, explicit prices, tax, and totals. Resolve quoteId through quotes.search. Reading makes no change.",
    inputSchema: { type: "object", additionalProperties: false, required: ["quoteId"], properties: { quoteId: { type: "string" } } },
    execute: async ({ arguments: args, context }) => {
      if (Object.keys(args).length !== 1 || typeof args.quoteId !== "string" || !args.quoteId.trim()) return { status: "rejected", warning: "Supply one resolved Quote ID." };
      const quote = await storage.getQuoteById(context.scope.organizationId, args.quoteId);
      if (!quote) return { status: "rejected", warning: "Quote not found in this organization." };
      const data = { id: quote.id, displayNumber: quote.displayNumber ?? String(quote.quoteNumber), revision: quote.revision, status: quote.status,
        customerId: quote.customerId, customerName: quote.customerName, contactId: quote.contactId, label: quote.label,
        requestedDueDate: quote.requestedDueDate, validUntil: quote.validUntil, customerNotes: quote.customerNotes,
        shippingMethod: quote.shippingMethod, shippingCents: quote.shippingCents, shippingInstructions: quote.shippingInstructions,
        discountAmount: quote.discountAmount, taxRate: quote.taxRate, subtotal: quote.subtotal, taxAmount: quote.taxAmount, totalPrice: quote.totalPrice,
        lines: quote.lineItems.map((line) => ({ id: line.id, productId: line.productId, productName: line.productName, variantId: line.variantId,
          width: line.width, height: line.height, quantity: line.quantity, optionSelectionsJson: line.optionSelectionsJson, description: line.description,
          productionNotes: line.productionNotes, linePrice: line.linePrice, overridePriceCents: line.overridePriceCents, overrideReason: line.overrideReason,
          status: line.status, displayOrder: line.displayOrder, requiresDesign: line.requiresDesign, requiresPrepress: line.requiresPrepress,
          requiresProofApproval: line.requiresProofApproval, isTaxableSnapshot: line.isTaxableSnapshot })), sourceLink: `/quotes/${quote.id}` };
      return { status: "succeeded", result: { status: "succeeded", data, provenance: { sourceLinks: [{ label: `Open Quote ${data.displayNumber}`, href: data.sourceLink }], freshness: { capturedAt: new Date().toISOString() } } } };
    },
  }, {
    name: "quotes.editor_save",
    description: "Prepare changes to an existing editable draft Quote using the staff Quote editor's one-transaction save. Supports customer/contact, PO label, due date, notes, delivery details, tax, discount, product options, dimensions, quantities, line addition/removal and reviewed manual line totals. Only requested fields and lines change. Returns before/after prices and totals; GO is required to save.",
    inputSchema: quoteEditorInputSchema as unknown as Record<string, unknown>,
    execute: async ({ arguments: args, context }) => {
      const parsed = quoteEditorRequestSchema.safeParse(args);
      if (!parsed.success) return { status: "rejected", failureCategory: "argument_validation", failureCode: "quote_editor_arguments_invalid", warning: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 1000) };
      try {
        const preview = await quoteEditorOperationService.prepare({ organizationId: context.scope.organizationId, userId: context.actor.userId, conversationId: context.conversationId, request: parsed.data });
        const summary = `Quote ${preview.quote.displayNumber}: ${preview.changes.length} reviewed change${preview.changes.length === 1 ? "" : "s"}; total $${(preview.totalCentsBefore / 100).toFixed(2)} → $${(preview.totalCentsAfter / 100).toFixed(2)}. Wait for GO to save.`;
        return { status: "succeeded", result: { status: "succeeded", data: { response: summary, taskDomain: "quotes", preview }, provenance: { sourceLinks: [{ label: `Open Quote ${preview.quote.displayNumber}`, href: preview.quote.sourceLink }], freshness: { capturedAt: new Date().toISOString() } } }, presentation: { cards: [
          { kind: "quote_intake_summary", title: "Quote edit preview", summary, sourceLinks: [{ label: `Open Quote ${preview.quote.displayNumber}`, href: preview.quote.sourceLink }], details: preview },
          { kind: "action_proposal", title: `Save Quote ${preview.quote.displayNumber}`, summary, sourceLinks: [], plan: { action: "quotes.update_draft", quoteId: preview.quote.id, quoteIntakeSessionId: preview.quoteIntakeSessionId, proposalFingerprint: preview.proposalFingerprint, expectedQuoteFingerprint: preview.expectedQuoteFingerprint } },
        ] as any } };
      } catch (error) { return { status: "rejected", failureCategory: "business_validation", failureCode: error && typeof error === "object" && "code" in error ? String(error.code) : "quote_editor_preparation_failed", warning: error instanceof Error ? error.message : "Quote edit review failed." }; }
    },
  }];
}
