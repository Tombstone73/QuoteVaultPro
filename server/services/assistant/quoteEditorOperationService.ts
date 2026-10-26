import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assistantQuoteIntakeSessions, customerContacts, customers, organizations, products, quoteListNotes, type AssistantQuoteIntakeSessionRow } from "@shared/schema";
import { dimensionsForProductPricing } from "@shared/productMeasurementMode";
import { db } from "../../db";
import { storage } from "../../storage";
import { calculateQuoteAggregateTotals } from "../../routes/helpers/quoteTotals.helpers";
import { quoteEditorSaveBodySchema, saveQuoteEditor } from "../../routes/quotes.routes";
import { buildQuoteLineItemPriceOverridePersistencePatch, haveLineItemPricingDriversChanged } from "../../lib/lineItemPricingPersistence";
import { priceLineItem } from "../pricing/PricingService";
import { calculateQuoteOrderTotals, getOrganizationTaxSettings } from "../../quoteOrderPricing";
import { quotePricingSnapshotForFingerprint } from "./quoteProposalFingerprint";
import type { QuoteDraftUpdatePreview, QuoteDraftUpdateCommandResult } from "./execution/quoteDraftUpdateCommand";

const id = z.string().min(1).max(128);
const manualPrice = { manualTotalCents: z.number().int().min(0).max(100_000_000).optional(), manualPriceReason: z.string().trim().min(1).max(500).optional() };
const selections = z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]));
const lineFields = z.object({
  productId: id.optional(), width: z.number().positive().max(10_000).optional(), height: z.number().positive().max(10_000).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(), optionSelections: selections.optional(),
  description: z.string().max(2_000).nullable().optional(), productionNotes: z.string().max(2_000).nullable().optional(),
  status: z.enum(["active", "canceled"]).optional(), requiresDesign: z.boolean().optional(),
  requiresPrepress: z.boolean().nullable().optional(), requiresProofApproval: z.boolean().nullable().optional(),
  displayOrder: z.number().int().optional(), ...manualPrice, clearManualPrice: z.boolean().optional(),
}).strict().refine((line) => line.manualTotalCents === undefined || Boolean(line.manualPriceReason), "A manual price requires a reason.").refine((line) => !line.clearManualPrice || line.manualTotalCents === undefined, "Cannot clear and set a manual price together.");
const createLine = z.object({
  productId: id, width: z.number().positive().max(10_000), height: z.number().positive().max(10_000),
  quantity: z.number().int().min(1).max(100_000), optionSelections: selections.optional(),
  description: z.string().max(2_000).nullable().optional(), productionNotes: z.string().max(2_000).nullable().optional(),
  requiresDesign: z.boolean().optional(), requiresPrepress: z.boolean().nullable().optional(), requiresProofApproval: z.boolean().nullable().optional(),
  displayOrder: z.number().int().optional(), ...manualPrice,
}).strict().refine((line) => line.manualTotalCents === undefined || Boolean(line.manualPriceReason), "A manual price requires a reason.");
export const quoteEditorRequestSchema = z.object({
  quoteId: id,
  header: z.object({
    customerId: id.nullable().optional(), contactId: id.nullable().optional(), label: z.string().max(255).nullable().optional(),
    requestedDueDate: z.string().datetime({ offset: true }).nullable().optional(),
    customerNotes: z.string().max(4_000).nullable().optional(), shippingInstructions: z.string().max(2_000).nullable().optional(),
    shippingMethod: z.enum(["pickup", "ship", "deliver"]).optional(), shippingCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    discountAmount: z.number().min(0).max(1_000_000).optional(), taxRate: z.number().min(0).max(1).optional(),
    visibleInCustomerPortal: z.boolean().optional(), tags: z.array(z.string().max(100)).max(30).optional(),
    shipToCompany: z.string().nullable().optional(), shipToName: z.string().nullable().optional(), shipToEmail: z.string().nullable().optional(),
    shipToPhone: z.string().nullable().optional(), shipToAddress1: z.string().nullable().optional(), shipToAddress2: z.string().nullable().optional(),
    shipToCity: z.string().nullable().optional(), shipToState: z.string().nullable().optional(), shipToPostalCode: z.string().nullable().optional(), shipToCountry: z.string().nullable().optional(),
  }).strict().default({}),
  lines: z.object({
    update: z.array(z.object({ id, changes: lineFields }).strict()).max(100).default([]),
    create: z.array(createLine).max(100).default([]), delete: z.array(id).max(100).default([]),
  }).strict().default({ update: [], create: [], delete: [] }),
}).strict().refine((request) => Object.keys(request.header).length > 0 || request.lines.update.length + request.lines.create.length + request.lines.delete.length > 0, "At least one Quote change is required.");
export type QuoteEditorRequest = z.infer<typeof quoteEditorRequestSchema>;
type EditorIntake = { kind: "editor_save"; request: QuoteEditorRequest; expectedRevision: number };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const asDate = (value: unknown) => value ? new Date(String(value)).toISOString().slice(0, 10) : null;

export class QuoteEditorOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function changedLineData(line: any, changes: z.infer<typeof lineFields>) {
  const productId = changes.productId ?? line.productId;
  const productChanged = productId !== line.productId;
  const optionSelectionsJson = changes.optionSelections === undefined ? productChanged ? { selected: {} } : line.optionSelectionsJson : { selected: changes.optionSelections };
  const existingOverride = line.priceOverride ?? line.specsJson?.priceOverride;
  const manual = changes.clearManualPrice ? null : changes.manualTotalCents !== undefined
    ? { mode: "override_total_after_margin", valueCents: changes.manualTotalCents } : existingOverride ?? null;
  return {
    productId, productName: changes.productId && changes.productId !== line.productId ? undefined : line.productName,
    variantId: productChanged ? null : line.variantId ?? null, variantName: productChanged ? null : line.variantName ?? null, productType: line.productType ?? "wide_roll",
    width: changes.width ?? Number(line.width), height: changes.height ?? Number(line.height), quantity: changes.quantity ?? line.quantity,
    specsJson: line.specsJson ?? {}, optionSelectionsJson, description: changes.description === undefined ? line.description ?? null : changes.description,
    productionNotes: changes.productionNotes === undefined ? line.productionNotes ?? null : changes.productionNotes,
    status: changes.status ?? line.status ?? "active", requiresDesign: changes.requiresDesign ?? line.requiresDesign ?? false,
    requiresPrepress: changes.requiresPrepress === undefined ? line.requiresPrepress ?? null : changes.requiresPrepress,
    requiresProofApproval: changes.requiresProofApproval === undefined ? line.requiresProofApproval ?? null : changes.requiresProofApproval,
    displayOrder: changes.displayOrder ?? line.displayOrder ?? 0, priceOverride: manual,
    ...(manual ? { overrideReason: changes.manualPriceReason ?? line.overrideReason ?? null } : { overridePriceCents: null, overrideReason: null }),
  };
}

export class QuoteEditorOperationService {
  private async session(organizationId: string, sessionId: string) {
    const [row] = await db.select().from(assistantQuoteIntakeSessions).where(and(eq(assistantQuoteIntakeSessions.id, sessionId), eq(assistantQuoteIntakeSessions.organizationId, organizationId))).limit(1);
    if (!row) throw new QuoteEditorOperationError("QUOTE_PROPOSAL_NOT_FOUND", "Quote proposal not found.");
    return row;
  }

  private async build(organizationId: string, session: AssistantQuoteIntakeSessionRow) {
    const intake = session.intakeJson as EditorIntake;
    if (intake.kind !== "editor_save" || session.quoteId !== intake.request.quoteId) throw new QuoteEditorOperationError("QUOTE_PROPOSAL_INVALID", "This is not a Quote editor proposal.");
    const request = quoteEditorRequestSchema.parse(intake.request);
    const quote = await storage.getQuoteById(organizationId, request.quoteId);
    if (!quote || quote.status !== "draft") throw new QuoteEditorOperationError("QUOTE_NOT_EDITABLE", "An editable draft Quote in this organization is required.");
    if (quote.revision !== intake.expectedRevision) throw new QuoteEditorOperationError("QUOTE_STALE", "The Quote changed after review. Prepare an updated review.");
    const current = quote.lineItems as any[];
    const byId = new Map(current.map((line) => [line.id, line]));
    const touched = [...request.lines.delete, ...request.lines.update.map((line) => line.id)];
    if (new Set(touched).size !== touched.length || touched.some((lineId) => !byId.has(lineId))) throw new QuoteEditorOperationError("QUOTE_LINE_STALE", "A requested Quote line is missing or touched twice.");
    if (current.length - request.lines.delete.length + request.lines.create.length < 1) throw new QuoteEditorOperationError("QUOTE_LINE_REQUIRED", "At least one line is required.");
    const customerId = request.header.customerId === undefined ? quote.customerId : request.header.customerId;
    const contactId = request.header.contactId === undefined ? quote.contactId : request.header.contactId;
    let targetCustomer: typeof customers.$inferSelect | undefined;
    let targetContact: { id: string; firstName: string | null; lastName: string | null } | undefined;
    if (customerId) {
      const [customer] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId))).limit(1);
      if (!customer) throw new QuoteEditorOperationError("CUSTOMER_NOT_FOUND", "The selected customer is not in this organization.");
      targetCustomer = customer;
      if (contactId) {
        const [contact] = await db.select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName }).from(customerContacts).where(and(eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId), eq(customerContacts.organizationId, organizationId))).limit(1);
        if (!contact) throw new QuoteEditorOperationError("CONTACT_NOT_FOUND", "The selected contact does not belong to the customer.");
        targetContact = contact;
      }
    } else if (contactId) throw new QuoteEditorOperationError("CONTACT_REQUIRES_CUSTOMER", "Select the contact's customer first.");
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) throw new QuoteEditorOperationError("ORGANIZATION_NOT_FOUND", "Organization not found.");
    const priceSnapshots: unknown[] = [];
    const nextLines = current.filter((line) => !request.lines.delete.includes(line.id)).map((line) => ({ ...line }));
    const updates: Array<{ id: string; data: any }> = [];
    const creates: Array<{ clientKey: string; data: any }> = [];
    const lineChanges: QuoteDraftUpdatePreview["changes"] = [];
    for (const change of request.lines.update) {
      const previous = byId.get(change.id)!;
      const data = changedLineData(previous, change.changes);
      const [product] = await db.select().from(products).where(and(eq(products.id, data.productId), eq(products.organizationId, organizationId))).limit(1);
      if (!product) throw new QuoteEditorOperationError("PRODUCT_NOT_FOUND", "A selected Product is unavailable.");
      if (change.changes.productId && change.changes.productId !== previous.productId) { data.productName = product.name; data.productType = product.productTypeId ?? "wide_roll"; }
      const pricingChanged = haveLineItemPricingDriversChanged({ existingLineItem: previous, incomingUpdate: data, pbv2ExplicitSelections: (data.optionSelectionsJson as any)?.selected });
      let baseCents = cents(previous.linePrice);
      let snapshot: unknown = null;
      let pricedSnapshot: unknown = previous.pbv2SnapshotJson;
      if (pricingChanged) {
        const size = dimensionsForProductPricing(product, data.width, data.height);
        const priced = await priceLineItem({ organizationId, productId: product.id, quantity: data.quantity, widthIn: size.widthIn, heightIn: size.heightIn, pbv2ExplicitSelections: (data.optionSelectionsJson as any)?.selected ?? {} });
        baseCents = priced.lineTotalCents;
        pricedSnapshot = priced.pbv2SnapshotJson;
        snapshot = quotePricingSnapshotForFingerprint(priced.pbv2SnapshotJson);
      }
      const override = buildQuoteLineItemPriceOverridePersistencePatch({ existingLineItem: { ...previous, ...data, linePrice: baseCents / 100, pbv2SnapshotJson: pricedSnapshot }, incomingUpdate: data, baseCalculatedTotalCents: pricingChanged ? baseCents : null });
      const nextCents = cents(override.linePrice);
      priceSnapshots.push({ id: previous.id, productId: product.id, productUpdatedAt: product.updatedAt, snapshot });
      updates.push({ id: change.id, data });
      const next = nextLines.find((line) => line.id === change.id)!;
      Object.assign(next, data, { specsJson: override.specsJson, pbv2SnapshotJson: pricedSnapshot, linePrice: nextCents / 100, effectiveTotalCents: nextCents,
        hasPriceOverride: override.pricing.hasPriceOverride, overridePriceCents: override.overridePriceCents, isTaxableSnapshot: product.isTaxable ?? true });
      lineChanges.push({ field: `Line ${change.id}`, before: JSON.stringify({ product: previous.productName, quantity: previous.quantity, width: previous.width, height: previous.height, options: (previous.optionSelectionsJson as any)?.selected ?? {}, description: previous.description ?? null, manualPriceReason: previous.overrideReason ?? null, totalCents: cents(previous.linePrice) }), after: JSON.stringify({ product: product.name, quantity: data.quantity, width: data.width, height: data.height, options: (data.optionSelectionsJson as any)?.selected ?? {}, description: data.description ?? null, manualPriceReason: data.overrideReason ?? null, totalCents: nextCents }) });
    }
    for (let index = 0; index < request.lines.create.length; index++) {
      const line = request.lines.create[index];
      const [product] = await db.select().from(products).where(and(eq(products.id, line.productId), eq(products.organizationId, organizationId), eq(products.isActive, true))).limit(1);
      if (!product) throw new QuoteEditorOperationError("PRODUCT_NOT_FOUND", `New line ${index + 1} needs an active Product in this organization.`);
      const size = dimensionsForProductPricing(product, line.width, line.height);
      const priced = await priceLineItem({ organizationId, productId: product.id, quantity: line.quantity, widthIn: size.widthIn, heightIn: size.heightIn, pbv2ExplicitSelections: line.optionSelections ?? {} });
      const nextCents = line.manualTotalCents ?? priced.lineTotalCents;
      priceSnapshots.push({ clientKey: `new-${index + 1}`, productId: product.id, productUpdatedAt: product.updatedAt, snapshot: quotePricingSnapshotForFingerprint(priced.pbv2SnapshotJson) });
      creates.push({ clientKey: `new-${index + 1}`, data: { productId: line.productId, productName: product.name, productType: product.productTypeId ?? "wide_roll", width: line.width, height: line.height, quantity: line.quantity, optionSelectionsJson: { selected: line.optionSelections ?? {} }, description: line.description ?? null, productionNotes: line.productionNotes ?? null, requiresDesign: line.requiresDesign, requiresPrepress: line.requiresPrepress, requiresProofApproval: line.requiresProofApproval, displayOrder: line.displayOrder ?? current.length + index, ...(line.manualTotalCents === undefined ? {} : { priceOverride: { mode: "override_total_after_margin", valueCents: line.manualTotalCents }, overrideReason: line.manualPriceReason }) } });
      nextLines.push({ ...creates[creates.length - 1].data, linePrice: nextCents / 100, effectiveTotalCents: nextCents,
        hasPriceOverride: line.manualTotalCents !== undefined, overridePriceCents: line.manualTotalCents ?? null,
        status: "active", isTaxableSnapshot: product.isTaxable ?? true });
      lineChanges.push({ field: `New line ${index + 1}`, before: null, after: JSON.stringify({ product: product.name, quantity: line.quantity, width: line.width, height: line.height, options: line.optionSelections ?? {}, description: line.description ?? null, manualPriceReason: line.manualPriceReason ?? null, totalCents: nextCents }) });
    }
    for (const lineId of request.lines.delete) { const old = byId.get(lineId)!; lineChanges.push({ field: `Removed line ${lineId}`, before: JSON.stringify({ product: old.productName, totalCents: cents(old.linePrice) }), after: null }); }
    const header: Record<string, unknown> = { ...request.header };
    if (customerId !== quote.customerId && customerId && request.header.taxRate === undefined) {
      const [customer] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId))).limit(1);
      const tax = await calculateQuoteOrderTotals(nextLines.map((line) => ({ productId: line.productId, linePrice: Number(line.linePrice), isTaxable: line.isTaxableSnapshot !== false })), getOrganizationTaxSettings(org), customer, null, { country: String(header.shipToCountry ?? quote.shipToCountry ?? "US"), state: String(header.shipToState ?? quote.shipToState ?? "") });
      header.taxRate = tax.taxRate;
    }
    const totals = calculateQuoteAggregateTotals({ lineItems: nextLines, discountAmount: header.discountAmount !== undefined ? header.discountAmount : quote.discountAmount, taxRate: header.taxRate !== undefined ? header.taxRate : quote.taxRate, shippingCents: header.shippingCents !== undefined ? header.shippingCents : quote.shippingCents });
    const display = (value: unknown): string | number | boolean | null => value == null ? null : value instanceof Date ? asDate(value) : typeof value === "object" ? JSON.stringify(value) : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : String(value);
    const [listNote] = request.header.tags !== undefined ? await db.select({ listLabel: quoteListNotes.listLabel }).from(quoteListNotes).where(and(eq(quoteListNotes.organizationId, organizationId), eq(quoteListNotes.quoteId, quote.id))).limit(1) : [];
    const [priorContact] = request.header.contactId !== undefined && quote.contactId ? await db.select({ firstName: customerContacts.firstName, lastName: customerContacts.lastName }).from(customerContacts).where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.id, quote.contactId))).limit(1) : [];
    const headerBefore = (field: string) => field === "tags" ? listNote?.listLabel ?? null : (quote as any)[field];
    const headerAfter = (field: string, value: unknown) => field === "customerId" ? targetCustomer?.companyName ?? null : field === "contactId" ? targetContact ? `${targetContact.firstName ?? ""} ${targetContact.lastName ?? ""}`.trim() : null : field === "requestedDueDate" ? asDate(value) : value;
    const headerBeforeLabel = (field: string) => field === "customerId" ? quote.customerName ?? null : field === "contactId" ? priorContact ? `${priorContact.firstName ?? ""} ${priorContact.lastName ?? ""}`.trim() : quote.contactId ?? null : headerBefore(field);
    const changes = [...Object.entries(request.header).map(([field, after]) => ({ field, before: display(headerBeforeLabel(field)), after: display(headerAfter(field, after)) })), ...lineChanges].map((change) => ({ field: change.field, before: typeof change.before === "string" && change.before.length > 2000 ? change.before.slice(0, 2000) : change.before, after: typeof change.after === "string" && change.after.length > 2000 ? change.after.slice(0, 2000) : change.after }));
    const payload = quoteEditorSaveBodySchema.parse({ expectedRevision: quote.revision, header, lines: { update: updates, create: creates, delete: request.lines.delete } });
    const expectedQuoteFingerprint = hash({ id: quote.id, revision: quote.revision, status: quote.status, customerId: quote.customerId, contactId: quote.contactId, lines: current.map((line) => ({ id: line.id, productId: line.productId, price: line.linePrice, quantity: line.quantity })) });
    const proposalFingerprint = hash({ sessionId: session.id, request, expectedQuoteFingerprint, priceSnapshots, totals });
    const preview: QuoteDraftUpdatePreview = { quote: { id: quote.id, displayNumber: quote.displayNumber ?? String(quote.quoteNumber), status: "draft", sourceLink: `/quotes/${quote.id}` }, quoteIntakeSessionId: session.id, proposalFingerprint, expectedQuoteFingerprint, expectedRevision: quote.revision, changes, subtotalCentsBefore: cents(quote.subtotal), subtotalCentsAfter: cents(totals.subtotal), taxCentsBefore: cents(quote.taxAmount), taxCentsAfter: cents(totals.taxAmount), totalCentsBefore: cents(quote.totalPrice), totalCentsAfter: cents(totals.totalPrice), validationErrors: [], warnings: [], affectedQuoteCount: 1, downstreamActionsExcluded: ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] };
    return { preview, payload };
  }

  async prepare(input: { organizationId: string; userId: string; conversationId: string; request: QuoteEditorRequest }) {
    const request = quoteEditorRequestSchema.parse(input.request);
    const quote = await storage.getQuoteById(input.organizationId, request.quoteId);
    if (!quote || quote.status !== "draft") throw new QuoteEditorOperationError("QUOTE_NOT_EDITABLE", "Resolve an editable draft Quote in this organization before preparing changes.");
    const [session] = await db.insert(assistantQuoteIntakeSessions).values({ organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId, quoteId: quote.id, createdByUserId: input.userId, intakeJson: { kind: "editor_save", request, expectedRevision: quote.revision } }).returning();
    if (!session) throw new QuoteEditorOperationError("QUOTE_PROPOSAL_FAILED", "Could not save the proposal.");
    try {
      const built = await this.build(input.organizationId, session);
      await db.transaction(async (tx) => {
        await tx.update(assistantQuoteIntakeSessions).set({ status: "abandoned", updatedAt: new Date() }).where(and(eq(assistantQuoteIntakeSessions.organizationId, input.organizationId), eq(assistantQuoteIntakeSessions.userId, input.userId), eq(assistantQuoteIntakeSessions.conversationId, input.conversationId), eq(assistantQuoteIntakeSessions.quoteId, quote.id), eq(assistantQuoteIntakeSessions.status, "preview_ready")));
        await tx.update(assistantQuoteIntakeSessions).set({ status: "preview_ready", proposalFingerprint: built.preview.proposalFingerprint, updatedAt: new Date() }).where(eq(assistantQuoteIntakeSessions.id, session.id));
      });
      return built.preview;
    } catch (error) { await db.update(assistantQuoteIntakeSessions).set({ status: "abandoned" }).where(eq(assistantQuoteIntakeSessions.id, session.id)); throw error; }
  }

  async revalidate(input: { organizationId: string; quoteId: string; quoteIntakeSessionId: string; expectedProposalFingerprint: string; expectedQuoteFingerprint: string }) {
    try {
      const session = await this.session(input.organizationId, input.quoteIntakeSessionId);
      if (session.quoteId !== input.quoteId || session.proposalFingerprint !== input.expectedProposalFingerprint) return { valid: false as const, code: "QUOTE_PROPOSAL_NOT_READY", summary: "The Quote proposal was superseded or mismatched." };
      if (session.status === "created") {
        const actual = await storage.getQuoteById(input.organizationId, input.quoteId);
        if (!actual) return { valid: false as const, code: "QUOTE_READBACK_FAILED", summary: "The saved Quote could not be read back." };
        return { valid: true as const, proposal: { quote: { id: actual.id, displayNumber: actual.displayNumber ?? String(actual.quoteNumber), status: "draft" as const, sourceLink: `/quotes/${actual.id}` }, quoteIntakeSessionId: session.id, proposalFingerprint: input.expectedProposalFingerprint, expectedQuoteFingerprint: input.expectedQuoteFingerprint, expectedRevision: actual.revision, changes: [{ field: "Already saved", before: null, after: "The confirmed Quote edit was already applied." }], subtotalCentsBefore: cents(actual.subtotal), subtotalCentsAfter: cents(actual.subtotal), taxCentsBefore: cents(actual.taxAmount), taxCentsAfter: cents(actual.taxAmount), totalCentsBefore: cents(actual.totalPrice), totalCentsAfter: cents(actual.totalPrice), validationErrors: [], warnings: [], affectedQuoteCount: 1 as const, downstreamActionsExcluded: ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] as QuoteDraftUpdatePreview["downstreamActionsExcluded"] } };
      }
      if (session.status !== "preview_ready") return { valid: false as const, code: "QUOTE_PROPOSAL_NOT_READY", summary: "The Quote proposal was superseded." };
      const built = await this.build(input.organizationId, session);
      if (built.preview.proposalFingerprint !== input.expectedProposalFingerprint || built.preview.expectedQuoteFingerprint !== input.expectedQuoteFingerprint || session.proposalFingerprint !== input.expectedProposalFingerprint) return { valid: false as const, code: "QUOTE_PROPOSAL_STALE", summary: "The Quote or pricing changed. Review an updated proposal." };
      return { valid: true as const, proposal: built.preview };
    } catch (error) { return { valid: false as const, code: error instanceof QuoteEditorOperationError ? error.code : "QUOTE_PREVIEW_FAILED", summary: error instanceof QuoteEditorOperationError ? error.message : "Could not verify the Quote review." }; }
  }

  async execute(input: { organizationId: string; actorUserId: string; quoteId: string; quoteIntakeSessionId: string; proposalFingerprint: string; expectedQuoteFingerprint: string }): Promise<QuoteDraftUpdateCommandResult> {
    const session = await this.session(input.organizationId, input.quoteIntakeSessionId);
    if (session.userId !== input.actorUserId || session.quoteId !== input.quoteId || session.proposalFingerprint !== input.proposalFingerprint) throw new QuoteEditorOperationError("QUOTE_PROPOSAL_FORBIDDEN", "This proposal is not available to this user.");
    if (session.status === "created") {
      const actual = await storage.getQuoteById(input.organizationId, input.quoteId);
      if (!actual) throw new QuoteEditorOperationError("QUOTE_READBACK_FAILED", "Saved Quote could not be read back.");
      return { quote: { id: actual.id, displayNumber: actual.displayNumber ?? String(actual.quoteNumber), status: "draft", totalCents: cents(actual.totalPrice), sourceLink: `/quotes/${actual.id}` } };
    }
    const checked = await this.revalidate({ organizationId: input.organizationId, quoteId: input.quoteId, quoteIntakeSessionId: input.quoteIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint, expectedQuoteFingerprint: input.expectedQuoteFingerprint });
    if (!checked.valid) throw new QuoteEditorOperationError(checked.code, checked.summary);
    const built = await this.build(input.organizationId, session);
    await saveQuoteEditor({ organizationId: input.organizationId, actorUserId: input.actorUserId, quoteId: input.quoteId, body: built.payload, onSaved: async (tx) => {
      const [locked] = await tx.select().from(assistantQuoteIntakeSessions).where(eq(assistantQuoteIntakeSessions.id, session.id)).for("update").limit(1);
      if (!locked || locked.status !== "preview_ready" || locked.proposalFingerprint !== input.proposalFingerprint) throw new QuoteEditorOperationError("QUOTE_PROPOSAL_STALE", "The Quote proposal was used or superseded.");
      await tx.update(assistantQuoteIntakeSessions).set({ status: "created", updatedAt: new Date() }).where(eq(assistantQuoteIntakeSessions.id, session.id));
    } });
    const actual = await storage.getQuoteById(input.organizationId, input.quoteId);
    if (!actual) throw new QuoteEditorOperationError("QUOTE_READBACK_FAILED", "Quote was saved but readback failed. Inspect the Quote before retrying.");
    if (cents(actual.totalPrice) !== checked.proposal.totalCentsAfter) throw new QuoteEditorOperationError("QUOTE_READBACK_MISMATCH", "Quote was saved but totals differ from the review. Inspect the Quote before retrying.");
    return { quote: { id: actual.id, displayNumber: actual.displayNumber ?? String(actual.quoteNumber), status: "draft", totalCents: cents(actual.totalPrice), sourceLink: `/quotes/${actual.id}` } };
  }

}

export const quoteEditorOperationService = new QuoteEditorOperationService();
