import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  assistantOrderIntakeSessions,
  auditLogs,
  customerContacts,
  customers,
  organizations,
  orders,
  products,
  quotes,
  type AssistantOrderIntakeSessionRow,
} from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings } from "../../quoteOrderPricing";
import { dimensionsForProductPricing } from "@shared/productMeasurementMode";
import { priceLineItem } from "../pricing/PricingService";
import { directOrderRequestText, parseOrderQuantity } from "./orderIntakeParsing";

type DirectLine = { productId: string; productName: string; quantity: number; width: number; height: number; };
type DirectIntake = { kind: "direct"; customerId: string | null; customerName: string; contactId: string | null; dueDate: string | null; lines: DirectLine[] };
type ConversionIntake = { kind: "conversion"; quoteId: string; quoteNumber: string; dueDate: string | null };
type UpdateIntake = { kind: "update"; orderId: string; orderNumber: string; dueDate: string };
type Intake = DirectIntake | ConversionIntake | UpdateIntake;

export class AssistantOrderIntakeError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value: string) => value.trim().toLocaleLowerCase();
const parseDimensions = (message: string) => {
  const match = message.match(/(\d+(?:\.\d+)?)\s*(?:in(?:ches)?|\")?\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(?:in(?:ches)?|\")?/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};
const parseDueDate = (message: string) => {
  const match = message.match(/\bdue\s+(\d{4}-\d{2}-\d{2})\b/i);
  return match && !Number.isNaN(Date.parse(match[1])) ? new Date(`${match[1]}T00:00:00.000Z`).toISOString() : null;
};

function findNamed<T extends { id: string; name?: string | null; companyName?: string | null }>(message: string, rows: T[], field: "name" | "companyName") {
  const text = normalized(message);
  const matches = rows.filter((row) => typeof row[field] === "string" && text.includes(normalized(String(row[field]))))
    .sort((a, b) => String(b[field]).length - String(a[field]).length);
  return matches.length === 1 || (matches.length > 1 && String(matches[0][field]).length > String(matches[1][field]).length) ? matches[0] : null;
}

export type AssistantOrderCard = { kind: "order_intake_summary" | "missing_information" | "action_proposal"; title: string; summary: string; sourceLinks: Array<{ label: string; href: string }>; plan?: Record<string, unknown>; details?: Record<string, unknown> };

/**
 * Server-owned conversational order proposals.  This intentionally persists
 * only record references and user intent; prices, tax, ownership, and the
 * explicit deferred-production policy are recalculated at planning/execution.
 */
export class OrderIntakeService {
  async respond(input: { organizationId: string; userId: string; conversationId: string; message: string; pendingRequest?: string | null }): Promise<{ handled: boolean; response: string; cards: AssistantOrderCard[] }> {
    if (/\b(?:update|change|edit)\b[\s\S]{0,40}\border\b/i.test(input.message)) return this.prepareUpdate(input);
    if (/\b(?:convert|turn)\b[\s\S]{0,40}\bquote\b[\s\S]{0,40}\b(?:order|into)\b|\bconvert\s+quote\s+\S+\s+(?:to|into)\s+order\b/i.test(input.message)) return this.prepareConversion(input);
    const message = directOrderRequestText(input.message, input.pendingRequest);
    if (!message) return { handled: false, response: "", cards: [] };
    const [customerRows, contactRows, productRows] = await Promise.all([
      db.select({ id: customers.id, companyName: customers.companyName }).from(customers).where(eq(customers.organizationId, input.organizationId)),
      db.select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName, email: customerContacts.email, customerId: customerContacts.customerId }).from(customerContacts).where(eq(customerContacts.organizationId, input.organizationId)),
      db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.isActive, true))),
    ]);
    const customer = findNamed(message, customerRows, "companyName");
    const contact = contactRows.find((row) => normalized(message).includes(normalized(`${row.firstName} ${row.lastName}`))) ?? null;
    const product = findNamed(message, productRows, "name");
    const dimensions = parseDimensions(message);
    const quantity = parseOrderQuantity(message);
    const missing = [!customer && !contact && "Customer/company or contact", !product && "Product", !dimensions && "Finished width and height", !quantity && "Quantity"].filter(Boolean) as string[];
    if (missing.length) return { handled: true, response: `I need ${missing.join(", ")} before I can prepare an order preview. I will not guess records or dimensions.`, cards: [{ kind: "missing_information", title: "Order information needed", summary: `Please provide: ${missing.join(", ")}.`, sourceLinks: [], details: { missing } }] };
    const session = await this.createSession(input, { kind: "direct", customerId: customer?.id ?? null, customerName: customer?.companyName ?? `${contact!.firstName} ${contact!.lastName}`.trim(), contactId: contact?.id ?? null, dueDate: parseDueDate(message), lines: [{ productId: product!.id, productName: product!.name ?? "Product", quantity: quantity!, width: dimensions!.width, height: dimensions!.height }] });
    const proposal = await this.revalidateCreateProposal({ organizationId: input.organizationId, orderIntakeSessionId: session.id, expectedProposalFingerprint: "" });
    if (!proposal.valid) throw new AssistantOrderIntakeError(proposal.code, proposal.summary);
    await db.update(assistantOrderIntakeSessions).set({ status: "preview_ready", proposalFingerprint: proposal.proposal.proposalFingerprint, updatedAt: new Date() }).where(eq(assistantOrderIntakeSessions.id, session.id));
    return { handled: true, response: "I prepared a server-priced order preview. Confirming creates one order with production explicitly deferred; it will not schedule, reserve inventory, create fulfillment, invoice, or payment records.", cards: [
      { kind: "order_intake_summary", title: "Order preview", summary: proposal.proposal.summary, sourceLinks: [], details: proposal.proposal },
      { kind: "action_proposal", title: "Create order", summary: "Creates one order only. Production intake remains deferred until a separate scheduling action.", sourceLinks: [], plan: { action: "orders.create", orderIntakeSessionId: session.id, proposalFingerprint: proposal.proposal.proposalFingerprint } },
    ] };
  }

  private async prepareUpdate(input: { organizationId: string; userId: string; conversationId: string; message: string }) {
    const orderNumber = input.message.match(/\border\s*#?([A-Za-z0-9-]+)\b/i)?.[1];
    const dueDate = parseDueDate(input.message);
    if (!orderNumber || !dueDate) return { handled: true, response: "Please provide the order number and a due date (for example, update order 20015 due 2026-08-01).", cards: [{ kind: "missing_information" as const, title: "Editable order update needed", summary: "An order number and due date are required.", sourceLinks: [] }] };
    const order = await storage.getOrderById(input.organizationId, orderNumber).catch(() => null) as any;
    const resolved = order ?? (await db.select({ id: orders.id, displayNumber: orders.displayNumber, orderNumber: orders.orderNumber, status: orders.status }).from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.displayNumber, orderNumber))).limit(1))[0];
    if (!resolved || String(resolved.status).toLowerCase() !== "new") return { handled: true, response: "Only orders still in the canonical new state can be edited through the assistant.", cards: [{ kind: "missing_information" as const, title: "Order is not editable", summary: "Open the order editor for non-new orders.", sourceLinks: [] }] };
    const session = await this.createSession(input, { kind: "update", orderId: resolved.id, orderNumber: resolved.displayNumber ?? String(resolved.orderNumber), dueDate });
    const fingerprint = hash({ kind: "update", orderId: resolved.id, dueDate, status: resolved.status });
    await db.update(assistantOrderIntakeSessions).set({ status: "preview_ready", proposalFingerprint: fingerprint, updatedAt: new Date() }).where(eq(assistantOrderIntakeSessions.id, session.id));
    return { handled: true, response: "I prepared one editable-order due-date update. Production, fulfillment, billing, and line items will remain unchanged.", cards: [{ kind: "order_intake_summary" as const, title: "Order update preview", summary: `Order ${resolved.displayNumber ?? resolved.orderNumber} due date will change to ${dueDate.slice(0, 10)}.`, sourceLinks: [{ label: `Open Order ${resolved.displayNumber ?? resolved.orderNumber}`, href: `/orders/${resolved.id}` }], details: { orderId: resolved.id, dueDate } }, { kind: "action_proposal" as const, title: "Update editable order", summary: "Updates only this order’s due date.", sourceLinks: [], plan: { action: "orders.update_editable", orderIntakeSessionId: session.id, proposalFingerprint: fingerprint } }] };
  }

  private async prepareConversion(input: { organizationId: string; userId: string; conversationId: string; message: string }) {
    const quoteNumber = input.message.match(/\bquote\s*#?([A-Za-z0-9-]+)\b/i)?.[1];
    if (!quoteNumber) return { handled: true, response: "Please identify the quote number to convert. I will prepare a deferred-production order preview without repricing it.", cards: [{ kind: "missing_information" as const, title: "Quote number needed", summary: "Provide the quote number to convert.", sourceLinks: [] }] };
    const [quote] = await db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber, displayNumber: quotes.displayNumber, convertedToOrderId: quotes.convertedToOrderId })
      .from(quotes).where(and(eq(quotes.organizationId, input.organizationId), eq(quotes.displayNumber, quoteNumber))).limit(1);
    if (!quote || quote.convertedToOrderId) return { handled: true, response: "That quote is unavailable for conversion. Open the quote to review its current state.", cards: [{ kind: "missing_information" as const, title: "Convertible quote needed", summary: "The selected quote was not found or is already converted.", sourceLinks: [] }] };
    const session = await this.createSession(input, { kind: "conversion", quoteId: quote.id, quoteNumber: quote.displayNumber ?? String(quote.quoteNumber), dueDate: parseDueDate(input.message) });
    const proposal = await this.revalidateCreateProposal({ organizationId: input.organizationId, orderIntakeSessionId: session.id, expectedProposalFingerprint: "" });
    if (!proposal.valid) throw new AssistantOrderIntakeError(proposal.code, proposal.summary);
    await db.update(assistantOrderIntakeSessions).set({ status: "preview_ready", proposalFingerprint: proposal.proposal.proposalFingerprint, updatedAt: new Date() }).where(eq(assistantOrderIntakeSessions.id, session.id));
    return { handled: true, response: "I prepared a quote-conversion preview. It preserves the quote’s price, tax, options, and line grouping and creates no production jobs.", cards: [{ kind: "order_intake_summary" as const, title: "Quote conversion preview", summary: proposal.proposal.summary, sourceLinks: [{ label: `Open Quote ${quote.displayNumber ?? quote.quoteNumber}`, href: `/quotes/${quote.id}` }], details: proposal.proposal }, { kind: "action_proposal" as const, title: "Convert quote to order", summary: "Converts this quote once with production explicitly deferred.", sourceLinks: [], plan: { action: "quotes.convert_to_order", orderIntakeSessionId: session.id, proposalFingerprint: proposal.proposal.proposalFingerprint } }] };
  }

  private async createSession(input: { organizationId: string; userId: string; conversationId: string }, intake: Intake) {
    const [session] = await db.insert(assistantOrderIntakeSessions).values({ organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId, quoteId: intake.kind === "conversion" ? intake.quoteId : null, createdByUserId: input.userId, intakeJson: intake }).returning();
    if (!session) throw new AssistantOrderIntakeError("SESSION_CREATE_FAILED", "Unable to store the order proposal.");
    return session;
  }

  private async load(organizationId: string, id: string): Promise<AssistantOrderIntakeSessionRow> {
    const [session] = await db.select().from(assistantOrderIntakeSessions).where(and(eq(assistantOrderIntakeSessions.id, id), eq(assistantOrderIntakeSessions.organizationId, organizationId))).limit(1);
    if (!session) throw new AssistantOrderIntakeError("SESSION_NOT_FOUND", "Order proposal not found.");
    return session;
  }

  async revalidateCreateProposal(input: { organizationId: string; orderIntakeSessionId: string; expectedProposalFingerprint: string }): Promise<{ valid: true; proposal: any } | { valid: false; code: string; summary: string }> {
    const session = await this.load(input.organizationId, input.orderIntakeSessionId);
    const intake = session.intakeJson as Intake;
    if (!intake?.kind) return { valid: false, code: "ORDER_INTAKE_INVALID", summary: "Order proposal is incomplete." };
    if (intake.kind === "conversion") {
      const fingerprint = hash({ kind: intake.kind, quoteId: intake.quoteId, dueDate: intake.dueDate });
      if (input.expectedProposalFingerprint && input.expectedProposalFingerprint !== fingerprint) return { valid: false, code: "ORDER_PROPOSAL_STALE", summary: "The conversion proposal changed." };
      return { valid: true, proposal: { orderIntakeSessionId: session.id, proposalFingerprint: fingerprint, kind: intake.kind, quoteId: intake.quoteId, summary: `Convert quote ${intake.quoteNumber} into one order. Quote prices, tax, selected options, and line grouping are preserved; production remains deferred.`, totalCents: null, lines: [], warnings: [], downstreamActionsExcluded: ["production_job_creation", "production_scheduling", "inventory_reservation", "fulfillment_creation", "invoice_creation", "payment_processing"] } };
    }
    if (intake.kind === "update") {
      const order = await storage.getOrderById(input.organizationId, intake.orderId);
      if (!order || String((order as any).status).toLowerCase() !== "new") return { valid: false, code: "ORDER_NOT_EDITABLE", summary: "Only orders still in the new state can be updated." };
      const proposalFingerprint = hash({ kind: intake.kind, orderId: intake.orderId, dueDate: intake.dueDate, status: (order as any).status, updatedAt: (order as any).updatedAt });
      if (input.expectedProposalFingerprint && input.expectedProposalFingerprint !== proposalFingerprint) return { valid: false, code: "ORDER_PROPOSAL_STALE", summary: "The order changed. Review a fresh update preview." };
      return { valid: true, proposal: { orderIntakeSessionId: session.id, proposalFingerprint, kind: intake.kind, orderId: intake.orderId, customerName: null, totalCents: Math.round(Number((order as any).total) * 100), lines: [], warnings: [], downstreamActionsExcluded: ["production_job_creation", "production_scheduling", "inventory_reservation", "fulfillment_creation", "invoice_creation", "payment_processing"], summary: `Update due date on order ${intake.orderNumber} to ${intake.dueDate.slice(0, 10)}.` } };
    }
    const [org, customer, contact] = await Promise.all([
      db.select().from(organizations).where(eq(organizations.id, input.organizationId)).limit(1).then((rows) => rows[0]),
      intake.customerId ? db.select().from(customers).where(and(eq(customers.id, intake.customerId), eq(customers.organizationId, input.organizationId))).limit(1).then((rows) => rows[0]) : Promise.resolve(null),
      intake.contactId ? db.select().from(customerContacts).where(and(eq(customerContacts.id, intake.contactId), eq(customerContacts.organizationId, input.organizationId))).limit(1).then((rows) => rows[0]) : Promise.resolve(null),
    ]);
    if (!org || (intake.customerId && !customer) || (intake.contactId && !contact) || (!customer && !contact)) return { valid: false, code: "ORDER_IDENTITY_REQUIRED", summary: "The selected customer or contact is no longer available." };
    const priced = await Promise.all(intake.lines.map(async (line) => {
      const [product] = await db.select().from(products).where(and(eq(products.id, line.productId), eq(products.organizationId, input.organizationId), eq(products.isActive, true))).limit(1);
      if (!product) throw new AssistantOrderIntakeError("ORDER_PRODUCT_NOT_FOUND", `Product ${line.productName} is unavailable.`);
      const size = dimensionsForProductPricing(product, line.width, line.height);
      const result = await priceLineItem({ organizationId: input.organizationId, productId: product.id, quantity: line.quantity, widthIn: size.widthIn, heightIn: size.heightIn, pbv2ExplicitSelections: {} });
      return { line, product, result, widthIn: size.widthIn, heightIn: size.heightIn };
    }));
    const totals = await calculateQuoteOrderTotals(priced.map(({ line, product, result }) => ({ productId: line.productId, linePrice: result.lineTotalCents / 100, isTaxable: product.isTaxable ?? true })), getOrganizationTaxSettings(org), customer, null, null);
    const fingerprint = hash({ intake, products: priced.map((row) => ({ id: row.product.id, updatedAt: row.product.updatedAt, pricing: row.result.pbv2SnapshotJson })), totals });
    if (input.expectedProposalFingerprint && input.expectedProposalFingerprint !== fingerprint) return { valid: false, code: "ORDER_PROPOSAL_STALE", summary: "Order pricing or selected records changed." };
    return { valid: true, proposal: { orderIntakeSessionId: session.id, proposalFingerprint: fingerprint, kind: intake.kind, customerName: intake.customerName, contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null, dueDate: intake.dueDate, totalCents: Math.round(totals.total * 100), taxCents: Math.round(totals.taxAmount * 100), lines: priced.map(({ line, result }) => ({ productName: line.productName, quantity: line.quantity, width: line.width, height: line.height, totalCents: result.lineTotalCents })), warnings: intake.contactId ? [] : ["No contact is selected."], downstreamActionsExcluded: ["production_job_creation", "production_scheduling", "inventory_reservation", "fulfillment_creation", "invoice_creation", "payment_processing"], summary: `Create one order for ${intake.customerName}, totaling $${totals.total.toFixed(2)}. Production remains deferred.` } };
  }

  async createConfirmedOrder(input: { organizationId: string; actorUserId: string; orderIntakeSessionId: string; proposalFingerprint: string }) {
    const session = await this.load(input.organizationId, input.orderIntakeSessionId);
    if (session.userId !== input.actorUserId) throw new AssistantOrderIntakeError("SESSION_FORBIDDEN", "Order proposal is not available to this user.");
    if (session.status === "created" && session.orderId) {
      const order = await storage.getOrderById(input.organizationId, session.orderId);
      if (order) return { id: order.id, displayNumber: order.displayNumber ?? String(order.orderNumber), totalCents: Math.round(Number(order.total) * 100), sourceLink: `/orders/${order.id}` };
    }
    const validation = await this.revalidateCreateProposal({ organizationId: input.organizationId, orderIntakeSessionId: session.id, expectedProposalFingerprint: input.proposalFingerprint });
    if (!validation.valid) throw new AssistantOrderIntakeError(validation.code, validation.summary);
    const intake = session.intakeJson as Intake;
    const order = intake.kind === "update"
      ? await storage.updateOrder(input.organizationId, intake.orderId, { dueDate: intake.dueDate } as any)
      : intake.kind === "conversion"
      ? await storage.convertQuoteToOrder(input.organizationId, intake.quoteId, input.actorUserId, { ...(intake.dueDate ? { dueDate: new Date(intake.dueDate) } : {}), productionIntakePolicy: "deferred" } as any)
      : await this.createDirect(input.organizationId, input.actorUserId, intake, validation.proposal);
    await db.transaction(async (tx) => {
      await tx.update(assistantOrderIntakeSessions).set({ status: "created", orderId: order.id, updatedAt: new Date() }).where(eq(assistantOrderIntakeSessions.id, session.id));
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "order", entityId: order.id, actionType: intake.kind === "conversion" ? "assistant_quote_converted_to_order" : intake.kind === "update" ? "assistant_order_updated" : "assistant_order_created", description: `Assistant confirmed ${intake.kind === "conversion" ? "quote conversion" : intake.kind === "update" ? "editable order update" : "order creation"}${intake.kind === "update" ? "" : " with deferred production intake"}.`, newValues: { ...(intake.kind === "update" ? { dueDate: intake.dueDate } : { productionIntakePolicy: "deferred" }), assistantOrderIntakeSessionId: session.id } });
    });
    return { id: order.id, displayNumber: order.displayNumber ?? String(order.orderNumber), totalCents: Math.round(Number(order.total) * 100), sourceLink: `/orders/${order.id}` };
  }

  private async createDirect(organizationId: string, actorUserId: string, intake: DirectIntake, proposal: any) {
    const priced = await Promise.all(intake.lines.map(async (line, index) => {
      const [product] = await db.select().from(products).where(and(eq(products.id, line.productId), eq(products.organizationId, organizationId), eq(products.isActive, true))).limit(1);
      if (!product) throw new AssistantOrderIntakeError("ORDER_PRODUCT_NOT_FOUND", `Product ${line.productName} is unavailable.`);
      const size = dimensionsForProductPricing(product, line.width, line.height);
      const result = await priceLineItem({ organizationId, productId: product.id, quantity: line.quantity, widthIn: size.widthIn, heightIn: size.heightIn, pbv2ExplicitSelections: {} });
      return { product, line, result, index, size };
    }));
    const [org, customer, contact] = await Promise.all([
      db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1).then((rows) => rows[0]),
      intake.customerId ? db.select().from(customers).where(and(eq(customers.id, intake.customerId), eq(customers.organizationId, organizationId))).limit(1).then((rows) => rows[0]) : Promise.resolve(null),
      intake.contactId ? db.select().from(customerContacts).where(and(eq(customerContacts.id, intake.contactId), eq(customerContacts.organizationId, organizationId))).limit(1).then((rows) => rows[0]) : Promise.resolve(null),
    ]);
    if (!org || (intake.customerId && !customer) || (intake.contactId && !contact) || (!customer && !contact)) throw new AssistantOrderIntakeError("ORDER_IDENTITY_REQUIRED", "The selected customer or contact is unavailable.");
    const totals = await calculateQuoteOrderTotals(priced.map(({ product, line, result }) => ({ productId: product.id, linePrice: result.lineTotalCents / 100, isTaxable: product.isTaxable ?? true })), getOrganizationTaxSettings(org), customer, null, null);
    return storage.createOrder(organizationId, { customerId: intake.customerId, contactId: intake.contactId, status: "new", dueDate: intake.dueDate, createdByUserId: actorUserId, taxRate: totals.taxRate, taxAmount: totals.taxAmount, taxableSubtotal: totals.taxableSubtotal, productionIntakePolicy: "deferred", lineItems: priced.map(({ product, line, result, index, size }) => ({ productId: product.id, productType: product.productTypeId ?? "wide_roll", description: product.name, width: size.widthIn, height: size.heightIn, quantity: line.quantity, unitPrice: result.lineTotalCents / 100 / line.quantity, totalPrice: result.lineTotalCents / 100, selectedOptions: result.pbv2SnapshotJson.selectedOptions ?? [], optionSelectionsJson: { selected: {} }, pbv2TreeVersionId: result.pbv2TreeVersionId, pbv2SnapshotJson: result.pbv2SnapshotJson, pricedAt: new Date(), sortOrder: index, taxAmount: totals.lineItemsWithTax[index]?.taxAmount ?? 0, isTaxableSnapshot: Boolean(product.isTaxable), requiresPrepress: Boolean((product as any).requiresPrepress), requiresProofApproval: Boolean((product as any).requiresProofApproval) })) } as any);
  }
}

export const orderIntakeService = new OrderIntakeService();
