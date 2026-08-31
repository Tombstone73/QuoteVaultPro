import { createHash } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  assistantBillingIntakeSessions,
  customerContacts,
  customers,
  invoices,
  orderLineItems,
  orders,
  products,
  type AssistantBillingIntakeSessionRow,
} from "@shared/schema";
import { db } from "../../db";
import { canonicalInvoiceOperations } from "../billing/canonicalInvoiceOperations";
import { resolveInvoiceFinancialEligibility } from "../orderBillingService";
import { isCanceledOrder } from "@shared/operationalState";

export const billingInvoiceOperationCommandNames = [
  "billing.create_invoice",
  "billing.update_invoice_draft",
  "billing.send_invoice",
  "billing.add_invoice_note",
] as const;
export type BillingInvoiceOperationCommandName = typeof billingInvoiceOperationCommandNames[number];

type Intake = {
  command: BillingInvoiceOperationCommandName;
  orderIds?: string[];
  lineItemIds?: string[];
  invoiceId?: string;
  patch?: { terms?: "due_on_receipt" | "net_15" | "net_30" | "net_45" | "custom"; customDueDate?: string; notesPublic?: string };
  note?: string;
};

type SourceLink = { label: string; href: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const termValues = ["due_on_receipt", "net_15", "net_30", "net_45", "custom"] as const;

export class BillingInvoiceOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function ids(value: string): string[] {
  return value.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
}

function sourceLinkForInvoice(id: string): SourceLink { return { label: "Open invoice", href: `/invoices/${id}` }; }
function sourceLinkForOrder(id: string): SourceLink { return { label: "Open order", href: `/orders/${id}` }; }

/**
 * Assistant-only invoice orchestration. It persists opaque proposals and
 * delegates all financial and state changes to canonical invoice services.
 */
export class BillingInvoiceOperationsService {
  async respond(input: { organizationId: string; userId: string; conversationId: string; message: string }) {
    const message = input.message.trim();
    const createOrder = message.match(/\b(?:create|make)\s+(?:an?\s+)?invoice\s+(?:for\s+)?(?:orders?\s+)?([\w,-]+)/i);
    const createLines = message.match(/\b(?:create|make)\s+(?:an?\s+)?invoice\s+(?:for\s+)?line\s*items?\s+([\w,-]+)/i);
    const updateTerms = message.match(/\bupdate\s+invoice\s+([\w-]+)\s+(?:terms?\s*)?(due_on_receipt|net_15|net_30|net_45|custom)\b/i);
    const updateNote = message.match(/\bupdate\s+invoice\s+([\w-]+)\s+(?:public\s+)?note\s*[:\-]\s*(.+)$/i);
    const send = message.match(/\b(?:send|mark)\s+invoice\s+([\w-]+)\s+(?:as\s+)?sent\b/i);
    const note = message.match(/\b(?:add\s+)?(?:internal\s+)?invoice\s+note\s+(?:to|for)\s+([\w-]+)\s*[:\-]\s*(.+)$/i);
    let intake: Intake | null = null;
    if (createLines) intake = { command: "billing.create_invoice", lineItemIds: ids(createLines[1]) };
    else if (createOrder) intake = { command: "billing.create_invoice", orderIds: ids(createOrder[1]) };
    else if (updateTerms) intake = { command: "billing.update_invoice_draft", invoiceId: updateTerms[1], patch: { terms: updateTerms[2].toLowerCase() as Intake["patch"] extends infer P ? P extends { terms?: infer T } ? T : never : never } };
    else if (updateNote) intake = { command: "billing.update_invoice_draft", invoiceId: updateNote[1], patch: { notesPublic: updateNote[2].trim() } };
    else if (send) intake = { command: "billing.send_invoice", invoiceId: send[1] };
    else if (note) intake = { command: "billing.add_invoice_note", invoiceId: note[1], note: note[2].trim() };
    if (!intake) return { handled: false, response: "", cards: [] };
    try {
      const proposal = await this.createProposal({ ...input, intake });
      return {
        handled: true,
        response: "I prepared an invoicing preview. Review it and use the dedicated GO control; free-text GO cannot execute it.",
        cards: [
          { kind: "billing_invoice_operation_proposal", title: "Invoicing operation proposal", summary: proposal.summary, sourceLinks: proposal.sourceLinks, details: proposal },
          { kind: "action_proposal", title: "Confirm invoicing operation", summary: "Confirmation is required. This operation cannot create payments or mark an invoice paid.", sourceLinks: [], plan: { action: intake.command, billingIntakeSessionId: proposal.billingIntakeSessionId, proposalFingerprint: proposal.proposalFingerprint } },
        ],
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Unable to prepare invoicing operation.";
      return { handled: true, response: summary, cards: [{ kind: "missing_information", title: "Invoicing operation unavailable", summary, sourceLinks: [] }] };
    }
  }

  private async createProposal(input: { organizationId: string; userId: string; conversationId: string; intake: Intake }) {
    const [session] = await db.insert(assistantBillingIntakeSessions).values({
      organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId,
      commandName: input.intake.command, intakeJson: input.intake,
    }).returning();
    if (!session) throw new BillingInvoiceOperationError("SESSION_CREATE_FAILED", "Unable to persist invoicing proposal.");
    const proposal = await this.buildProposal(input.organizationId, session);
    await db.update(assistantBillingIntakeSessions).set({ proposalFingerprint: proposal.proposalFingerprint, updatedAt: new Date() }).where(eq(assistantBillingIntakeSessions.id, session.id));
    return proposal;
  }

  private async load(organizationId: string, id: string) {
    const [session] = await db.select().from(assistantBillingIntakeSessions)
      .where(and(eq(assistantBillingIntakeSessions.id, id), eq(assistantBillingIntakeSessions.organizationId, organizationId))).limit(1);
    if (!session) throw new BillingInvoiceOperationError("SESSION_NOT_FOUND", "Invoicing proposal not found.");
    return session;
  }

  private async resolveInvoiceContext(organizationId: string, invoiceId: string) {
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId))).limit(1);
    if (!invoice) throw new BillingInvoiceOperationError("INVOICE_NOT_FOUND", "Invoice not found.");
    if (!invoice.orderId) throw new BillingInvoiceOperationError("ORDER_NOT_FOUND", "The invoice has no billable order context.");
    const [order] = await db.select().from(orders).where(and(eq(orders.id, invoice.orderId), eq(orders.organizationId, organizationId))).limit(1);
    if (!order) throw new BillingInvoiceOperationError("ORDER_NOT_FOUND", "The invoice order is unavailable.");
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, invoice.customerId), eq(customers.organizationId, organizationId))).limit(1);
    if (!customer) throw new BillingInvoiceOperationError("CUSTOMER_NOT_FOUND", "The invoice customer is unavailable.");
    const contact = order.contactId
      ? (await db.select().from(customerContacts).where(and(eq(customerContacts.id, order.contactId), eq(customerContacts.organizationId, organizationId), eq(customerContacts.customerId, customer.id))).limit(1))[0] ?? null
      : null;
    if (order.contactId && !contact) throw new BillingInvoiceOperationError("CONTACT_NOT_FOUND", "The invoice contact is unavailable.");
    return { invoice, order, customer, contact };
  }

  async buildProposal(organizationId: string, session: AssistantBillingIntakeSessionRow) {
    const intake = session.intakeJson as Intake;
    const sourceLinks: SourceLink[] = [];
    let source: unknown;
    let summary: string;
    if (intake.command === "billing.create_invoice") {
      const requestedOrderIds = Array.from(new Set(intake.orderIds ?? []));
      const requestedLineItemIds = Array.from(new Set(intake.lineItemIds ?? []));
      if (requestedLineItemIds.length) throw new BillingInvoiceOperationError("PARTIAL_INVOICE_UNSUPPORTED", "Invoice creation is order-scoped; partial line-item invoicing is not supported.");
      if ((!requestedOrderIds.length && !requestedLineItemIds.length) || requestedOrderIds.length + requestedLineItemIds.length > 10) throw new BillingInvoiceOperationError("ORDER_REQUIRED", "Select between one and ten orders or line items.");
      const selectedLines = requestedLineItemIds.length
        ? await db.select({ id: orderLineItems.id, orderId: orderLineItems.orderId }).from(orderLineItems).innerJoin(orders, eq(orders.id, orderLineItems.orderId))
          .where(and(eq(orders.organizationId, organizationId), inArray(orderLineItems.id, requestedLineItemIds)))
        : [];
      if (selectedLines.length !== requestedLineItemIds.length) throw new BillingInvoiceOperationError("LINE_ITEM_NOT_FOUND", "One or more line items are unavailable.");
      const orderIds = Array.from(new Set([...requestedOrderIds, ...selectedLines.map((line) => line.orderId)]));
      const rows = await db.select().from(orders).where(and(eq(orders.organizationId, organizationId), inArray(orders.id, orderIds)));
      if (rows.length !== orderIds.length) throw new BillingInvoiceOperationError("ORDER_NOT_FOUND", "One or more orders are unavailable.");
      if (rows.some((order) => isCanceledOrder(order))) throw new BillingInvoiceOperationError("ORDER_CANCELLED", "Cancelled orders cannot be invoiced.");
      const existing = await db.select({ orderId: invoices.orderId }).from(invoices).where(and(eq(invoices.organizationId, organizationId), inArray(invoices.orderId, orderIds), ne(invoices.status, "void" as any)));
      if (existing.length) throw new BillingInvoiceOperationError("ORDER_ALREADY_INVOICED", "One or more selected orders already have a non-void invoice.");
      const invoiceLines = await db.select({ orderId: orderLineItems.orderId, totalPrice: orderLineItems.totalPrice, workflowIntent: products.workflowIntent, allowZeroPrice: products.allowZeroPrice })
        .from(orderLineItems).leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId))).where(inArray(orderLineItems.orderId, orderIds));
      for (const orderId of orderIds) {
        const eligibility = resolveInvoiceFinancialEligibility(invoiceLines.filter((line) => line.orderId === orderId));
        if (!eligibility.canCreateInvoice) throw new BillingInvoiceOperationError(eligibility.code ?? "ORDER_NOT_BILLABLE", eligibility.message ?? "The order is not billable.");
      }
      source = { rows, invoiceLines, selectedLineIds: requestedLineItemIds };
      sourceLinks.push(...rows.map((order) => sourceLinkForOrder(order.id)));
      summary = `Create ${orderIds.length} draft invoice${orderIds.length === 1 ? "" : "s"} from eligible order pricing.`;
    } else {
      if (!intake.invoiceId) throw new BillingInvoiceOperationError("INVOICE_REQUIRED", "An invoice is required.");
      const context = await this.resolveInvoiceContext(organizationId, intake.invoiceId);
      if (intake.command === "billing.update_invoice_draft") {
        if (String(context.invoice.status || "").toLowerCase() !== "draft") throw new BillingInvoiceOperationError("INVOICE_NOT_EDITABLE", "Only draft invoices can be updated.");
        if (!intake.patch || Object.keys(intake.patch).length === 0) throw new BillingInvoiceOperationError("PATCH_REQUIRED", "Provide safe invoice details to update.");
      }
      if (intake.command === "billing.send_invoice" && ["void", "paid", "partially_paid"].includes(String(context.invoice.status || "").toLowerCase())) throw new BillingInvoiceOperationError("INVOICE_NOT_SENDABLE", "This invoice cannot be marked sent.");
      if (intake.command === "billing.add_invoice_note" && !intake.note?.trim()) throw new BillingInvoiceOperationError("NOTE_REQUIRED", "An internal invoice note is required.");
      source = context;
      sourceLinks.push(sourceLinkForInvoice(context.invoice.id), sourceLinkForOrder(context.order.id));
      summary = intake.command === "billing.update_invoice_draft" ? "Update safe, non-financial draft invoice details." : intake.command === "billing.send_invoice" ? "Mark the eligible invoice as sent manually; no payment is created." : "Add an internal invoice note without changing invoice, payment, order, production, or fulfillment status.";
    }
    return { billingIntakeSessionId: session.id, commandName: intake.command, proposalFingerprint: hash({ sessionId: session.id, intake, source }), summary, sourceLinks };
  }

  async revalidateProposal(input: { organizationId: string; billingIntakeSessionId: string; expectedProposalFingerprint: string }) {
    const session = await this.load(input.organizationId, input.billingIntakeSessionId);
    if (session.status !== "preview_ready") return { valid: false as const, code: "BILLING_PROPOSAL_NOT_READY", summary: "Invoicing proposal is no longer available." };
    const proposal = await this.buildProposal(input.organizationId, session);
    return session.proposalFingerprint === input.expectedProposalFingerprint && proposal.proposalFingerprint === input.expectedProposalFingerprint
      ? { valid: true as const, proposal }
      : { valid: false as const, code: "BILLING_PROPOSAL_STALE", summary: "Billing records changed; review a fresh proposal." };
  }

  async executeConfirmed(input: { organizationId: string; actorUserId: string; billingIntakeSessionId: string; proposalFingerprint: string }) {
    const session = await this.load(input.organizationId, input.billingIntakeSessionId);
    if (session.userId !== input.actorUserId) throw new BillingInvoiceOperationError("SESSION_FORBIDDEN", "Only the proposing user can confirm this invoicing operation.");
    const validation = await this.revalidateProposal({ organizationId: input.organizationId, billingIntakeSessionId: session.id, expectedProposalFingerprint: input.proposalFingerprint });
    if (!validation.valid) throw new BillingInvoiceOperationError(validation.code, validation.summary);
    const intake = session.intakeJson as Intake;
    const sourceLinks: SourceLink[] = [];
    if (intake.command === "billing.create_invoice") {
      const proposal = validation.proposal;
      const orderLinks = proposal.sourceLinks.filter((link) => link.href.startsWith("/orders/"));
      const orderIds = orderLinks.map((link) => link.href.split("/").pop()!).sort();
      const created = await canonicalInvoiceOperations.createOrderBackedInvoicesFromOrders({ organizationId: input.organizationId, actorUserId: input.actorUserId, orderIds, terms: "due_on_receipt", customDueDate: null, auditSource: "assistant" });
      const createdLinks = created.flatMap((invoice: any) => [sourceLinkForInvoice(invoice.id), sourceLinkForOrder(String(invoice.orderId))]);
      sourceLinks.push(...createdLinks);
    } else if (intake.command === "billing.update_invoice_draft") {
      const patch = intake.patch!;
      const result = await canonicalInvoiceOperations.updateSafeDraft({ organizationId: input.organizationId, invoiceId: intake.invoiceId!, actorUserId: input.actorUserId, patch: { ...patch, customDueDate: patch.customDueDate ? new Date(patch.customDueDate) : undefined } });
      if (!result.updated.orderId) throw new BillingInvoiceOperationError("ORDER_NOT_FOUND", "The invoice has no billable order context.");
      sourceLinks.push(sourceLinkForInvoice(result.updated.id), sourceLinkForOrder(result.updated.orderId));
    } else if (intake.command === "billing.send_invoice") {
      const invoice = await canonicalInvoiceOperations.markSent({ organizationId: input.organizationId, invoiceId: intake.invoiceId!, actorUserId: input.actorUserId });
      if (!invoice.orderId) throw new BillingInvoiceOperationError("ORDER_NOT_FOUND", "The invoice has no billable order context.");
      sourceLinks.push(sourceLinkForInvoice(invoice.id), sourceLinkForOrder(invoice.orderId));
    } else {
      const result = await canonicalInvoiceOperations.addInternalNote({ organizationId: input.organizationId, invoiceId: intake.invoiceId!, actorUserId: input.actorUserId, note: intake.note!.trim() });
      if (!result.updated.orderId) throw new BillingInvoiceOperationError("ORDER_NOT_FOUND", "The invoice has no billable order context.");
      sourceLinks.push(sourceLinkForInvoice(result.updated.id), sourceLinkForOrder(result.updated.orderId));
    }
    await db.update(assistantBillingIntakeSessions).set({ status: "created", updatedAt: new Date() }).where(eq(assistantBillingIntakeSessions.id, session.id));
    return { sourceLinks, summary: validation.proposal.summary };
  }
}

export const billingInvoiceOperationsService = new BillingInvoiceOperationsService();
