import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  assistantQuoteIntakeSessions,
  auditLogs,
  customerContacts,
  customers,
  organizations,
  products,
  type AssistantQuoteIntakeSessionRow,
} from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings } from "../../quoteOrderPricing";
import { normalizeQuoteCreateLineItem } from "../../lib/quoteCreateLineItemNormalizer";
import { dimensionsForProductPricing } from "@shared/productMeasurementMode";
import { priceLineItem } from "../pricing/PricingService";
import type { QuoteDraftCreateCanonicalService, QuoteDraftCreateCommandResult } from "./execution/quoteDraftCreateCommand";
import type { QuoteDraftUpdateCanonicalService, QuoteDraftUpdateCommandResult } from "./execution/quoteDraftUpdateCommand";

type IntakeLine = { productId: string; productName: string; quantity: number; width: number; height: number; optionSelections: Record<string, unknown>; parentClientKey?: string | null };
type Intake = { customerId: string; customerName: string; contactId: string | null; requestedDueDate: string | null; internalNote: string | null; lines: IntakeLine[] };

export class QuoteDraftIntakeError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value: string) => value.trim().toLocaleLowerCase();

function nextFriday(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = ((5 - date.getUTCDay() + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function parseDimensions(message: string): { width: number; height: number } | null {
  const match = message.match(/(\d+(?:\.\d+)?)\s*(?:in(?:ches)?|\")?\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(?:in(?:ches)?|\")?/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseQuantity(message: string): number | null {
  const match = message.match(/\b(\d+)\s*(?:qty|pieces?|units?|each)\b/i);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

function parseDueDate(message: string): string | null {
  if (/\bnext\s+friday\b/i.test(message)) return nextFriday();
  const match = message.match(/\bdue\s+(\d{4}-\d{2}-\d{2})\b/i);
  return match && !Number.isNaN(Date.parse(match[1])) ? new Date(`${match[1]}T00:00:00.000Z`).toISOString() : null;
}

function parseInternalNote(message: string): string | null {
  const match = message.match(/\b(?:internal\s+note|note)\s*[:\-]\s*(.+)$/i);
  return match?.[1]?.trim().slice(0, 4000) || null;
}

function matchByName<T extends { id: string; name?: string | null; companyName?: string | null }>(message: string, rows: T[], field: "name" | "companyName") {
  const text = normalized(message);
  const matches = rows.filter((row) => {
    const name = row[field];
    return typeof name === "string" && name.trim().length > 1 && text.includes(normalized(name));
  }).sort((a, b) => String(b[field]).length - String(a[field]).length);
  return matches.length === 1 || (matches.length > 1 && String(matches[0][field]).length > String(matches[1][field]).length) ? matches[0] : null;
}

export type QuoteDraftAssistantCard = { kind: "quote_intake_summary" | "missing_information" | "action_proposal"; title: string; summary: string; sourceLinks: Array<{ label: string; href: string }>; plan?: Record<string, unknown>; details?: Record<string, unknown> };

/** The only place conversational text becomes a normalized quote request. It
 * resolves tenant-owned records first and refuses to guess a customer/product. */
export class QuoteDraftIntakeService implements QuoteDraftCreateCanonicalService, QuoteDraftUpdateCanonicalService {
  async respond(input: { organizationId: string; userId: string; conversationId: string; message: string }): Promise<{ handled: boolean; response: string; cards: QuoteDraftAssistantCard[] }> {
    if (/\b(?:update|change|edit)\b[\s\S]{0,80}\bquote\b/i.test(input.message)) {
      return this.prepareUpdate(input);
    }
    if (!/\b(?:create|start|make|build)\b[\s\S]{0,80}\bquote\b/i.test(input.message)) return { handled: false, response: "", cards: [] };
    const [customerRows, productRows] = await Promise.all([
      db.select({ id: customers.id, companyName: customers.companyName }).from(customers).where(eq(customers.organizationId, input.organizationId)),
      db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.isActive, true))),
    ]);
    const customer = matchByName(input.message, customerRows, "companyName");
    const product = matchByName(input.message, productRows, "name");
    const dimensions = parseDimensions(input.message);
    const quantity = parseQuantity(input.message);
    const missing = [!customer && "Customer/company", !product && "Product", !dimensions && "Finished width and height", !quantity && "Quantity"].filter(Boolean) as string[];
    if (missing.length) {
      return { handled: true, response: `I need ${missing.join(", ")} before I can prepare a draft quote preview. I will not guess customer, product, dimensions, or quantity.`, cards: [{ kind: "missing_information", title: "Quote information needed", summary: `Please provide: ${missing.join(", ")}.`, sourceLinks: [], details: { missing } }] };
    }
    const contacts = await db.select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName })
      .from(customerContacts).where(and(eq(customerContacts.organizationId, input.organizationId), eq(customerContacts.customerId, customer!.id)));
    const contact = contacts.find((row) => normalized(input.message).includes(normalized(`${row.firstName ?? ""} ${row.lastName ?? ""}`))) ?? null;
    const intake: Intake = { customerId: customer!.id, customerName: customer!.companyName ?? "Customer", contactId: contact?.id ?? null, requestedDueDate: parseDueDate(input.message), internalNote: parseInternalNote(input.message), lines: [{ productId: product!.id, productName: product!.name ?? "Product", quantity: quantity!, width: dimensions!.width, height: dimensions!.height, optionSelections: {} }] };
    const [session] = await db.insert(assistantQuoteIntakeSessions).values({ organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId, createdByUserId: input.userId, intakeJson: intake }).returning();
    if (!session) throw new QuoteDraftIntakeError("SESSION_CREATE_FAILED", "Unable to store the quote intake.");
    const proposal = await this.buildCreateProposal(input.organizationId, session);
    await db.update(assistantQuoteIntakeSessions).set({ status: "preview_ready", proposalFingerprint: proposal.fingerprint, updatedAt: new Date() }).where(eq(assistantQuoteIntakeSessions.id, session.id));
    return { handled: true, response: "I prepared a server-priced draft quote preview. Review every field and use the dedicated GO control to create one draft quote.", cards: [
      { kind: "quote_intake_summary", title: "Draft quote preview", summary: proposal.summary, sourceLinks: [], details: proposal.preview },
      { kind: "action_proposal", title: "Create draft quote", summary: "This creates one draft quote only. It does not send, accept, convert, schedule, invoice, reserve inventory, or create a customer.", sourceLinks: [], plan: { action: "quotes.create_draft", quoteIntakeSessionId: session.id, proposalFingerprint: proposal.fingerprint } },
    ] };
  }

  private async load(organizationId: string, sessionId: string): Promise<AssistantQuoteIntakeSessionRow> {
    const [session] = await db.select().from(assistantQuoteIntakeSessions).where(and(eq(assistantQuoteIntakeSessions.id, sessionId), eq(assistantQuoteIntakeSessions.organizationId, organizationId))).limit(1);
    if (!session) throw new QuoteDraftIntakeError("SESSION_NOT_FOUND", "Quote intake session not found.");
    return session;
  }

  private quoteFingerprint(quote: { id: string; status: string; customerId: string | null; contactId: string | null; totalPrice: unknown; requestedDueDate: string | null }) {
    return hash({ id: quote.id, status: quote.status, customerId: quote.customerId, contactId: quote.contactId, totalPrice: String(quote.totalPrice), requestedDueDate: quote.requestedDueDate });
  }

  private async prepareUpdate(input: { organizationId: string; userId: string; conversationId: string; message: string }): Promise<{ handled: boolean; response: string; cards: QuoteDraftAssistantCard[] }> {
    const [prior] = await db.select().from(assistantQuoteIntakeSessions).where(and(
      eq(assistantQuoteIntakeSessions.organizationId, input.organizationId),
      eq(assistantQuoteIntakeSessions.userId, input.userId),
      eq(assistantQuoteIntakeSessions.conversationId, input.conversationId),
      eq(assistantQuoteIntakeSessions.status, "created"),
    )).orderBy(desc(assistantQuoteIntakeSessions.updatedAt)).limit(1);
    if (!prior?.quoteId) return { handled: true, response: "I can only edit a draft quote created in this conversation. Open the existing quote editor for other quotes.", cards: [{ kind: "missing_information", title: "Draft quote needed", summary: "Create a draft quote in this conversation first, then state the change you want.", sourceLinks: [] }] };
    const dueDate = parseDueDate(input.message);
    if (!dueDate) return { handled: true, response: "Please provide a new due date (for example, “update the quote due 2026-07-31”). I will preview that one exact editable-draft change.", cards: [{ kind: "missing_information", title: "Draft update needs a due date", summary: "This conversational update currently requires an explicit due date.", sourceLinks: [] }] };
    const [session] = await db.insert(assistantQuoteIntakeSessions).values({ organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId, quoteId: prior.quoteId, createdByUserId: input.userId, status: "collecting", intakeJson: { ...(prior.intakeJson as Record<string, unknown>), requestedDueDate: dueDate } }).returning();
    if (!session) throw new QuoteDraftIntakeError("SESSION_CREATE_FAILED", "Unable to store the draft update proposal.");
    const validation = await this.revalidateUpdateProposal({ organizationId: input.organizationId, quoteId: prior.quoteId, quoteIntakeSessionId: session.id, expectedProposalFingerprint: "", expectedQuoteFingerprint: "" });
    if (!validation.valid) throw new QuoteDraftIntakeError(validation.code, validation.summary);
    await db.update(assistantQuoteIntakeSessions).set({ status: "preview_ready", proposalFingerprint: validation.proposal.proposalFingerprint, updatedAt: new Date() }).where(eq(assistantQuoteIntakeSessions.id, session.id));
    return { handled: true, response: "I prepared an exact editable-draft quote update. Review it and use the dedicated GO control to apply only this change.", cards: [{ kind: "quote_intake_summary", title: "Draft quote update preview", summary: `Quote ${validation.proposal.quote.displayNumber} will have its requested due date updated.`, sourceLinks: [{ label: `Open Quote ${validation.proposal.quote.displayNumber}`, href: validation.proposal.quote.sourceLink }], details: validation.proposal }, { kind: "action_proposal", title: "Update draft quote", summary: "This updates one editable draft quote only. It cannot send, accept, convert, schedule, invoice, or email.", sourceLinks: [], plan: { action: "quotes.update_draft", quoteId: validation.proposal.quote.id, quoteIntakeSessionId: session.id, proposalFingerprint: validation.proposal.proposalFingerprint, expectedQuoteFingerprint: validation.proposal.expectedQuoteFingerprint } }] };
  }

  private async buildCreateProposal(organizationId: string, session: AssistantQuoteIntakeSessionRow) {
    const intake = session.intakeJson as Intake;
    if (!intake?.customerId || !Array.isArray(intake.lines) || !intake.lines.length) throw new QuoteDraftIntakeError("INTAKE_INVALID", "Quote intake is incomplete.");
    const [org, customer] = await Promise.all([
      db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1).then((rows) => rows[0]),
      db.select().from(customers).where(and(eq(customers.id, intake.customerId), eq(customers.organizationId, organizationId))).limit(1).then((rows) => rows[0]),
    ]);
    if (!org || !customer) throw new QuoteDraftIntakeError("CUSTOMER_NOT_FOUND", "The selected customer is no longer available.");
    const priced = await Promise.all(intake.lines.map(async (line) => {
      const [product] = await db.select().from(products).where(and(eq(products.id, line.productId), eq(products.organizationId, organizationId), eq(products.isActive, true))).limit(1);
      if (!product) throw new QuoteDraftIntakeError("PRODUCT_NOT_FOUND", `Product ${line.productName} is no longer active.`);
      const size = dimensionsForProductPricing(product, line.width, line.height);
      const result = await priceLineItem({ organizationId, productId: product.id, quantity: line.quantity, widthIn: size.widthIn, heightIn: size.heightIn, pbv2ExplicitSelections: line.optionSelections });
      return { line, product, result, widthIn: size.widthIn, heightIn: size.heightIn };
    }));
    const totals = await calculateQuoteOrderTotals(priced.map(({ line, product, result }) => ({ productId: line.productId, linePrice: result.lineTotalCents / 100, isTaxable: product.isTaxable ?? true })), getOrganizationTaxSettings(org), customer, null, null);
    const preview = {
      quoteIntakeSessionId: session.id, customerName: intake.customerName, contactName: intake.contactId ? "Selected contact" : null, quoteTitle: null,
      lineItems: priced.map(({ line, result }, index) => ({ clientKey: `line-${index + 1}`, productName: line.productName, quantity: line.quantity, dimensions: { width: line.width, height: line.height, unit: "in" }, parentClientKey: line.parentClientKey ?? null, lineSubtotalCents: result.lineTotalCents, taxCents: Math.round((totals.lineItemsWithTax[index]?.taxAmount ?? 0) * 100), totalCents: result.lineTotalCents + Math.round((totals.lineItemsWithTax[index]?.taxAmount ?? 0) * 100) })),
      subtotalCents: Math.round(totals.subtotal * 100), taxCents: Math.round(totals.taxAmount * 100), totalCents: Math.round(totals.total * 100), validationErrors: [], warnings: intake.contactId ? [] : ["No contact was selected; the draft remains internal."], affectedQuoteCount: 1,
      downstreamActionsExcluded: ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] as const,
    };
    return { fingerprint: hash({ intake, prices: priced.map((row) => ({ productId: row.product.id, updatedAt: row.product.updatedAt, snapshot: row.result.pbv2SnapshotJson })), totals: { subtotal: preview.subtotalCents, tax: preview.taxCents } }), preview, priced, totals, summary: `${intake.customerName}: ${preview.lineItems.length} line item${preview.lineItems.length === 1 ? "" : "s"}, total $${(preview.totalCents / 100).toFixed(2)}.` };
  }

  async revalidateCreateProposal(input: { organizationId: string; quoteIntakeSessionId: string; expectedProposalFingerprint: string }) {
    const session = await this.load(input.organizationId, input.quoteIntakeSessionId);
    if (session.status !== "preview_ready") return { valid: false as const, code: "QUOTE_INTAKE_NOT_READY", summary: "The quote intake is not ready for confirmation." };
    const proposal = await this.buildCreateProposal(input.organizationId, session);
    if (session.proposalFingerprint !== input.expectedProposalFingerprint || proposal.fingerprint !== input.expectedProposalFingerprint) {
      return { valid: false as const, code: "QUOTE_PROPOSAL_STALE", summary: "Quote pricing or selected records changed. Review a fresh preview." };
    }
    return { valid: true as const, proposal: { ...proposal.preview, proposalFingerprint: proposal.fingerprint } };
  }

  async revalidateUpdateProposal(input: { organizationId: string; quoteId: string; quoteIntakeSessionId: string; expectedProposalFingerprint: string; expectedQuoteFingerprint: string }) {
    const session = await this.load(input.organizationId, input.quoteIntakeSessionId);
    if (session.quoteId !== input.quoteId) return { valid: false as const, code: "QUOTE_SESSION_MISMATCH", summary: "The quote update proposal does not belong to this quote." };
    const quote = await storage.getQuoteById(input.organizationId, input.quoteId);
    if (!quote || quote.status !== "draft") return { valid: false as const, code: "QUOTE_NOT_EDITABLE", summary: "Only canonical draft quotes can be edited through the assistant." };
    const dueDate = (session.intakeJson as Intake).requestedDueDate;
    if (!dueDate) return { valid: false as const, code: "QUOTE_UPDATE_INCOMPLETE", summary: "A requested due date is required for this draft update." };
    const expectedQuoteFingerprint = this.quoteFingerprint(quote);
    const proposalFingerprint = hash({ sessionId: session.id, quoteFingerprint: expectedQuoteFingerprint, requestedDueDate: dueDate });
    if ((input.expectedProposalFingerprint && input.expectedProposalFingerprint !== proposalFingerprint) || (input.expectedQuoteFingerprint && input.expectedQuoteFingerprint !== expectedQuoteFingerprint)) return { valid: false as const, code: "QUOTE_PROPOSAL_STALE", summary: "The quote changed. Review a fresh update preview." };
    const totalCents = Math.round(Number(quote.totalPrice) * 100);
    return { valid: true as const, proposal: { quote: { id: quote.id, displayNumber: quote.displayNumber ?? String(quote.quoteNumber), status: "draft" as const, sourceLink: `/quotes/${quote.id}` }, quoteIntakeSessionId: session.id, proposalFingerprint, expectedQuoteFingerprint, changes: [{ field: "Requested due date", before: quote.requestedDueDate ?? null, after: dueDate }], subtotalCentsBefore: Math.round(Number(quote.subtotal) * 100), subtotalCentsAfter: Math.round(Number(quote.subtotal) * 100), taxCentsBefore: Math.round(Number(quote.taxAmount) * 100), taxCentsAfter: Math.round(Number(quote.taxAmount) * 100), totalCentsBefore: totalCents, totalCentsAfter: totalCents, validationErrors: [], warnings: [], affectedQuoteCount: 1 as const, downstreamActionsExcluded: ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] as ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] } };
  }

  async createDraft(input: Parameters<QuoteDraftCreateCanonicalService["createDraft"]>[0]): Promise<QuoteDraftCreateCommandResult> {
    const session = await this.load(input.organizationId, input.quoteIntakeSessionId);
    if (session.userId !== input.actorUserId) throw new QuoteDraftIntakeError("SESSION_FORBIDDEN", "Quote intake is not available to this user.");
    if (session.status === "created" && session.quoteId) {
      const existing = await storage.getQuoteById(input.organizationId, session.quoteId);
      if (existing) return { quote: { id: existing.id, displayNumber: existing.displayNumber ?? String(existing.quoteNumber), status: "draft", totalCents: Math.round(Number(existing.totalPrice) * 100), sourceLink: `/quotes/${existing.id}` } };
    }
    const proposal = await this.buildCreateProposal(input.organizationId, session);
    if (proposal.fingerprint !== input.proposalFingerprint || session.proposalFingerprint !== input.proposalFingerprint) throw new QuoteDraftIntakeError("PROPOSAL_STALE", "The draft quote inputs or pricing changed. Review a new preview before confirming.");
    const intake = session.intakeJson as Intake;
    const lineItems = proposal.priced.map(({ line, product, result, widthIn, heightIn }, index) => normalizeQuoteCreateLineItem({ productId: line.productId, productName: line.productName, productType: product.productTypeId ?? "wide_roll", width: product.measurementMode === "quantity_only" ? 1 : widthIn, height: product.measurementMode === "quantity_only" ? 1 : heightIn, quantity: line.quantity, optionSelectionsJson: { selected: line.optionSelections }, selectedOptions: result.pbv2SnapshotJson.selectedOptions ?? [], linePrice: result.lineTotalCents / 100, priceBreakdown: { basePrice: result.breakdown.baseCents / 100, optionsPrice: result.breakdown.optionsCents / 100, total: result.lineTotalCents / 100, formula: "" }, pbv2TreeVersionId: result.pbv2TreeVersionId, pbv2SnapshotJson: result.pbv2SnapshotJson, pricedAt: new Date(), displayOrder: index }, index, proposal.totals.lineItemsWithTax[index] ?? { taxAmount: 0, isTaxableSnapshot: Boolean(product.isTaxable) }).lineItem);
    const quote = await storage.createQuote(input.organizationId, { userId: input.actorUserId, customerId: intake.customerId, contactId: intake.contactId, customerName: intake.customerName, source: "internal", status: "draft", requestedDueDate: intake.requestedDueDate, lineItems: lineItems as any, taxRate: proposal.totals.taxRate, taxAmount: proposal.totals.taxAmount, taxableSubtotal: proposal.totals.taxableSubtotal });
    await db.transaction(async (tx) => {
      await tx.update(assistantQuoteIntakeSessions).set({ status: "created", quoteId: quote.id, updatedAt: new Date() }).where(and(eq(assistantQuoteIntakeSessions.id, session.id), eq(assistantQuoteIntakeSessions.organizationId, input.organizationId)));
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "quote", entityId: quote.id, actionType: "assistant_quote_draft_created", description: `Assistant created draft quote ${quote.displayNumber ?? quote.quoteNumber} from confirmed intake ${session.id}.` });
    });
    return { quote: { id: quote.id, displayNumber: quote.displayNumber ?? String(quote.quoteNumber), status: "draft", totalCents: Math.round(Number(quote.totalPrice) * 100), sourceLink: `/quotes/${quote.id}` } };
  }

  async updateDraft(input: Parameters<QuoteDraftUpdateCanonicalService["updateDraft"]>[0]): Promise<QuoteDraftUpdateCommandResult> {
    const session = await this.load(input.organizationId, input.quoteIntakeSessionId);
    if (session.userId !== input.actorUserId) throw new QuoteDraftIntakeError("SESSION_FORBIDDEN", "Quote intake is not available to this user.");
    const validation = await this.revalidateUpdateProposal({ organizationId: input.organizationId, quoteId: input.quoteId, quoteIntakeSessionId: input.quoteIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint, expectedQuoteFingerprint: input.expectedQuoteFingerprint });
    if (!validation.valid) throw new QuoteDraftIntakeError(validation.code, validation.summary);
    const dueDate = (session.intakeJson as Intake).requestedDueDate;
    const quote = await storage.updateQuote(input.organizationId, input.quoteId, { requestedDueDate: dueDate });
    await db.transaction(async (tx) => {
      await tx.update(assistantQuoteIntakeSessions).set({ status: "created", updatedAt: new Date() }).where(eq(assistantQuoteIntakeSessions.id, session.id));
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "quote", entityId: quote.id, actionType: "assistant_quote_draft_updated", description: `Assistant updated requested due date on draft quote ${quote.displayNumber ?? quote.quoteNumber} from confirmed intake ${session.id}.` });
    });
    return { quote: { id: quote.id, displayNumber: quote.displayNumber ?? String(quote.quoteNumber), status: "draft", totalCents: Math.round(Number(quote.totalPrice) * 100), sourceLink: `/quotes/${quote.id}` } };
  }
}

export const quoteDraftIntakeService = new QuoteDraftIntakeService();
