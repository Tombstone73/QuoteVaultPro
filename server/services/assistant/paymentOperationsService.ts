import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  assistantPaymentIntakeSessions,
  customerContacts,
  customers,
  invoices,
  orders,
  payments,
  type AssistantPaymentIntakeSessionRow,
} from "@shared/schema";
import { db } from "../../db";
import { assistantManualPaymentMethodValues, type AssistantManualPaymentMethod } from "../../invoicesService";
import { isCanceledOrder } from "@shared/operationalState";
import { getInvoiceFinancialPaymentEligibility } from "@shared/paymentOrchestration";
import { computeInvoicePaymentRollup } from "@shared/rollups/invoicePaymentRollup";
import { canonicalPaymentOperations } from "../billing/canonicalPaymentOperations";

export const paymentOperationCommandNames = [
  "payments.record_manual_payment",
  "payments.add_payment_note",
] as const;
export type PaymentOperationCommandName = typeof paymentOperationCommandNames[number];

type Intake = {
  command: PaymentOperationCommandName;
  invoiceId?: string;
  paymentId?: string;
  amount?: number;
  method?: AssistantManualPaymentMethod;
  paidAt?: string;
  note?: string;
};
type SourceLink = { label: string; href: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class PaymentOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function sourceLinkForInvoice(id: string): SourceLink { return { label: "Open invoice", href: `/invoices/${id}` }; }
function sourceLinkForOrder(id: string): SourceLink { return { label: "Open order", href: `/orders/${id}` }; }
function sourceLinkForCustomer(id: string): SourceLink { return { label: "Open customer", href: `/customers/${id}` }; }
function sourceLinkForPayment(id: string): SourceLink { return { label: "Open payment", href: `/invoices/payments/${id}` }; }

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PaymentOperationError("PAYMENT_DATE_INVALID", "Use a payment date in YYYY-MM-DD format.");
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new PaymentOperationError("PAYMENT_DATE_INVALID", "Use a valid payment date.");
  return date;
}

function parseMethod(value: string): AssistantManualPaymentMethod {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (!(assistantManualPaymentMethodValues as readonly string[]).includes(normalized)) {
    throw new PaymentOperationError("PAYMENT_METHOD_NOT_ALLOWED", "Use cash, check, wire, bank transfer, or other for an internal manual payment.");
  }
  return normalized as AssistantManualPaymentMethod;
}

/** Confirmation-bound orchestration; financial writes stay in invoicesService. */
export class PaymentOperationsService {
  async respond(input: { organizationId: string; userId: string; conversationId: string; message: string }) {
    const message = input.message.trim();
    const record = message.match(/\brecord\s+(?:a\s+)?(?:manual\s+)?payment\s+(?:for|to)\s+invoice\s+([\w-]+)\s+(?:of\s+|amount\s+)?\$?([0-9]+(?:\.[0-9]{1,2})?)\s+(?:via|by)\s+(cash|check|wire|bank[\s_-]?transfer|other)(?:\s+on\s+(\d{4}-\d{2}-\d{2}))?(?:\s+(?:reference|check|transaction|note)\s*[:#-]?\s*(.+))?$/i);
    const note = message.match(/\b(?:add\s+)?payment\s+note\s+(?:to|for)\s+([\w-]+)\s*[:\-]\s*(.+)$/i);
    let intake: Intake | null = null;
    if (record) {
      const amount = Number(record[2]);
      if (!Number.isFinite(amount) || amount <= 0) return this.unavailable("PAYMENT_AMOUNT_INVALID", "Provide a positive manual payment amount.");
      intake = { command: "payments.record_manual_payment", invoiceId: record[1], amount, method: parseMethod(record[3]), ...(record[4] ? { paidAt: record[4] } : {}), ...(record[5]?.trim() ? { note: record[5].trim() } : {}) };
    } else if (note) {
      intake = { command: "payments.add_payment_note", paymentId: note[1], note: note[2].trim() };
    }
    if (!intake) return { handled: false, response: "", cards: [] };
    try {
      const proposal = await this.createProposal({ ...input, intake });
      return {
        handled: true,
        response: "I prepared a manual-payment preview. Review it and use the dedicated GO control; free-text GO cannot record payments.",
        cards: [
          { kind: "payment_operation_proposal", title: "Payment operation proposal", summary: proposal.summary, sourceLinks: proposal.sourceLinks, details: proposal },
          { kind: "action_proposal", title: "Confirm payment operation", summary: "Confirmation is required. This does not call EPS, the customer portal, or a card/ACH processor.", sourceLinks: [], plan: { action: intake.command, paymentIntakeSessionId: proposal.paymentIntakeSessionId, proposalFingerprint: proposal.proposalFingerprint } },
        ],
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Unable to prepare payment operation.";
      return this.unavailable("PAYMENT_OPERATION_UNAVAILABLE", summary);
    }
  }

  private unavailable(_code: string, summary: string) {
    return { handled: true, response: summary, cards: [{ kind: "missing_information", title: "Payment operation unavailable", summary, sourceLinks: [] }] };
  }

  private async createProposal(input: { organizationId: string; userId: string; conversationId: string; intake: Intake }) {
    const [session] = await db.insert(assistantPaymentIntakeSessions).values({
      organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId,
      commandName: input.intake.command, intakeJson: input.intake,
    }).returning();
    if (!session) throw new PaymentOperationError("SESSION_CREATE_FAILED", "Unable to persist payment proposal.");
    const proposal = await this.buildProposal(input.organizationId, session);
    await db.update(assistantPaymentIntakeSessions).set({ proposalFingerprint: proposal.proposalFingerprint, updatedAt: new Date() }).where(eq(assistantPaymentIntakeSessions.id, session.id));
    return proposal;
  }

  private async load(organizationId: string, id: string) {
    const [session] = await db.select().from(assistantPaymentIntakeSessions).where(and(
      eq(assistantPaymentIntakeSessions.id, id), eq(assistantPaymentIntakeSessions.organizationId, organizationId),
    )).limit(1);
    if (!session) throw new PaymentOperationError("SESSION_NOT_FOUND", "Payment proposal not found.");
    return session;
  }

  private async resolveInvoiceContext(organizationId: string, invoiceId: string) {
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId))).limit(1);
    if (!invoice) throw new PaymentOperationError("INVOICE_NOT_FOUND", "Invoice not found.");
    if (!invoice.orderId) throw new PaymentOperationError("ORDER_NOT_FOUND", "The invoice has no order context.");
    const [order] = await db.select().from(orders).where(and(eq(orders.id, invoice.orderId), eq(orders.organizationId, organizationId))).limit(1);
    if (!order) throw new PaymentOperationError("ORDER_NOT_FOUND", "The invoice order is unavailable.");
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, invoice.customerId), eq(customers.organizationId, organizationId))).limit(1);
    if (!customer) throw new PaymentOperationError("CUSTOMER_NOT_FOUND", "The invoice customer is unavailable.");
    const contact = order.contactId
      ? (await db.select().from(customerContacts).where(and(eq(customerContacts.id, order.contactId), eq(customerContacts.organizationId, organizationId), eq(customerContacts.customerId, customer.id))).limit(1))[0] ?? null
      : null;
    if (order.contactId && !contact) throw new PaymentOperationError("CONTACT_NOT_FOUND", "The invoice contact is unavailable.");
    const invoicePayments = await db.select().from(payments).where(and(eq(payments.invoiceId, invoice.id), eq(payments.organizationId, organizationId)));
    return { invoice, order, customer, contact, payments: invoicePayments };
  }

  private async resolvePaymentContext(organizationId: string, paymentId: string) {
    const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId))).limit(1);
    if (!payment) throw new PaymentOperationError("PAYMENT_NOT_FOUND", "Payment not found.");
    return { payment, ...(await this.resolveInvoiceContext(organizationId, payment.invoiceId)) };
  }

  async buildProposal(organizationId: string, session: AssistantPaymentIntakeSessionRow) {
    const intake = session.intakeJson as Intake;
    let source: unknown;
    let summary: string;
    const sourceLinks: SourceLink[] = [];
    if (intake.command === "payments.record_manual_payment") {
      if (!intake.invoiceId || !intake.method || intake.amount === undefined) throw new PaymentOperationError("PAYMENT_INPUT_REQUIRED", "Invoice, amount, and method are required.");
      const context = await this.resolveInvoiceContext(organizationId, intake.invoiceId);
      if (isCanceledOrder(context.order)) throw new PaymentOperationError("ORDER_CANCELLED", "Cancelled orders cannot receive payments.");
      if (String((context.invoice as any).importSource || "").toLowerCase() === "quickbooks") throw new PaymentOperationError("IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED", "Imported QuickBooks invoices must be reconciled from QuickBooks.");
      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Math.max(0, Math.round(Number((context.invoice as any).totalCents || 0))),
        payments: context.payments.map((payment) => ({ id: payment.id, status: payment.status, amountCents: Number(payment.amountCents || 0) })),
      });
      const paymentEligibility = getInvoiceFinancialPaymentEligibility({ invoiceStatus: context.invoice.status, remainingCents: rollup.amountDueCents });
      if (!paymentEligibility.payable) throw new PaymentOperationError("INVOICE_NOT_PAYABLE", paymentEligibility.blockedReason || "This invoice cannot receive a manual payment.");
      const due = rollup.amountDueCents / 100;
      if (intake.amount > due + 0.00001) throw new PaymentOperationError("OVERPAYMENT_NOT_ALLOWED", "The requested payment exceeds the server-calculated amount due.");
      parseDate(intake.paidAt);
      source = { context, amount: intake.amount, method: intake.method, paidAt: intake.paidAt ?? null, note: intake.note ?? null };
      sourceLinks.push(sourceLinkForInvoice(context.invoice.id), sourceLinkForCustomer(context.customer.id), sourceLinkForOrder(context.order.id));
      summary = `Record a ${intake.method.replaceAll("_", " ")} manual payment of $${intake.amount.toFixed(2)} against the server-validated invoice balance.`;
    } else {
      if (!intake.paymentId || !intake.note?.trim()) throw new PaymentOperationError("PAYMENT_NOTE_REQUIRED", "A payment and internal note are required.");
      const context = await this.resolvePaymentContext(organizationId, intake.paymentId);
      source = { context, note: intake.note.trim() };
      sourceLinks.push(sourceLinkForPayment(context.payment.id), sourceLinkForInvoice(context.invoice.id), sourceLinkForCustomer(context.customer.id), sourceLinkForOrder(context.order.id));
      summary = "Add an internal payment note without changing the payment amount or any invoice, order, production, or fulfillment status.";
    }
    return { paymentIntakeSessionId: session.id, commandName: intake.command, proposalFingerprint: hash({ sessionId: session.id, intake, source }), summary, sourceLinks };
  }

  async revalidateProposal(input: { organizationId: string; paymentIntakeSessionId: string; expectedProposalFingerprint: string }) {
    const session = await this.load(input.organizationId, input.paymentIntakeSessionId);
    if (session.status !== "preview_ready") return { valid: false as const, code: "PAYMENT_PROPOSAL_NOT_READY", summary: "Payment proposal is no longer available." };
    const proposal = await this.buildProposal(input.organizationId, session);
    return session.proposalFingerprint === input.expectedProposalFingerprint && proposal.proposalFingerprint === input.expectedProposalFingerprint
      ? { valid: true as const, proposal }
      : { valid: false as const, code: "PAYMENT_PROPOSAL_STALE", summary: "Invoice or payment records changed; review a fresh proposal." };
  }

  async executeConfirmed(input: { organizationId: string; actorUserId: string; paymentIntakeSessionId: string; proposalFingerprint: string; idempotencyKey: string }) {
    const session = await this.load(input.organizationId, input.paymentIntakeSessionId);
    if (session.userId !== input.actorUserId) throw new PaymentOperationError("SESSION_FORBIDDEN", "Only the proposing user can confirm this payment operation.");
    const validation = await this.revalidateProposal({ organizationId: input.organizationId, paymentIntakeSessionId: session.id, expectedProposalFingerprint: input.proposalFingerprint });
    if (!validation.valid) throw new PaymentOperationError(validation.code, validation.summary);
    const intake = session.intakeJson as Intake;
    let sourceLinks: SourceLink[];
    if (intake.command === "payments.record_manual_payment") {
      const result = await canonicalPaymentOperations.recordManualPayment({
        organizationId: input.organizationId, invoiceId: intake.invoiceId!, actorUserId: input.actorUserId, amountCents: Math.round(intake.amount! * 100), method: intake.method!,
        ...(intake.paidAt ? { appliedAt: parseDate(intake.paidAt) } : {}), ...(intake.note ? { notes: intake.note } : {}),
        idempotencyKey: `assistant:${input.idempotencyKey}`,
        source: "assistant",
      });
      const payment = result.payment;
      const context = await this.resolveInvoiceContext(input.organizationId, payment.invoiceId);
      sourceLinks = [sourceLinkForPayment(payment.id), sourceLinkForInvoice(context.invoice.id), sourceLinkForCustomer(context.customer.id), sourceLinkForOrder(context.order.id)];
    } else {
      const result = await canonicalPaymentOperations.addInternalNote({ organizationId: input.organizationId, paymentId: intake.paymentId!, actorUserId: input.actorUserId, note: intake.note!.trim() });
      const context = await this.resolveInvoiceContext(input.organizationId, result.updated.invoiceId);
      sourceLinks = [sourceLinkForPayment(result.updated.id), sourceLinkForInvoice(context.invoice.id), sourceLinkForCustomer(context.customer.id), sourceLinkForOrder(context.order.id)];
    }
    await db.update(assistantPaymentIntakeSessions).set({ status: "created", updatedAt: new Date() }).where(eq(assistantPaymentIntakeSessions.id, session.id));
    return { sourceLinks, summary: validation.proposal.summary };
  }
}

export const paymentOperationsService = new PaymentOperationsService();
