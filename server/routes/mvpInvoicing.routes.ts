import type { Express } from "express";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, companySettings, customerContactLinks, customerContacts, customerPortalAccess, customers, invoiceLineItems, invoiceReminderLogs, invoices, orderLineItems, orders, organizations, payments, paymentWebhookEvents, products, users, manualPaymentMethodSchema, stripeRefundRequests } from "../../shared/schema";
import { createInvoiceEmailLog, createInvoiceFromOrder, getInvoiceEmailStatus, getInvoiceEmailStatuses, getInvoiceWithRelations, listInvoicesForOrganization, refreshInvoiceStatus, voidManualPaymentCanonical } from "../invoicesService";
import { buildInvoiceEmailSentAudit } from "../lib/invoiceEmailAudit";
import { getInvoiceListReminderInfo, getInvoiceReminderPreviewForOrg, getInvoiceReminderSettingsForOrg, upsertInvoiceReminderSettingsForOrg } from "../invoiceReminderService";
import { runInvoiceReminderJob, sendManualInvoiceReminder } from "../invoiceReminderJob";
import { updateInvoiceReminderSettingsSchema } from "../../shared/schema";
import { recomputeOrderBillingStatus, resolveInvoiceFinancialEligibility } from "../services/orderBillingService";
import { getValidAccessTokenForOrganization, syncSingleInvoiceToQuickBooksForOrganization, syncSinglePaymentToQuickBooksForOrganization } from "../quickbooksService";
import { computeInvoicePaymentRollup, getInvoicePaymentStatusLabel } from "../../shared/rollups/invoicePaymentRollup";
import { getStripeClient, getStripeWebhookSecret } from "../lib/stripe";
import { generateInvoicePdfBytes } from "../services/invoicePdf";
import { z } from "zod";
import { integrationConnections } from "../../shared/schema";
import { resolveQuickBooksPreferencesFromOrgPreferences, type QuickBooksSyncPolicy } from "../../shared/quickBooksPreferences";
import { normalizeInvoiceAccountingDisplay, normalizeQuickBooksLineItemsSnapshot } from "../../shared/invoiceAccountingDisplay";
import { resolveHostedPaymentProvider, type HostedPaymentProvider } from "../../shared/paymentProviderResolution";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { isCanceledOrder } from "../../shared/operationalState";
import { getPaymentSettings } from "../services/payments/paymentProvider.service";
import { resolveOrderPayment } from "../services/payments/paymentOrchestrator.service";
import { getPublicWebOrigin } from "../lib/appRuntimeConfig";
import { createInvoicePdfEmailAttachment } from "../services/invoiceEmailAttachment";
import { buildInvoiceEmailHtml, buildInvoicePortalPaymentUrl } from "../services/invoiceEmailContent";
import { getInvoiceOrderContext } from "../services/invoiceOrderContext";
import { prepareSingleContactPortalAccessForInvoice } from "../services/customerPortalAccessService";
import { canonicalInvoiceOperations } from "../services/billing/canonicalInvoiceOperations";
import { canonicalManualPaymentMethodValues, canonicalPaymentOperations } from "../services/billing/canonicalPaymentOperations";
import { buildInvoiceEmailRecipients, isValidInvoiceRecipientEmail, type InvoiceEmailRecipient } from "../../shared/invoiceEmailRecipients";
import { captureAndApply as captureAndApplyStripeObservation, retryByEvent as retryStripeObservationByEvent } from "../services/stripePaymentReconciliationService";
import { resolveStripeReadiness } from "../services/stripeReadiness.service";
import { resolveStripeRuntimeConfig } from "../services/stripeRuntimeConfig.service";
import { getStripeRefundEligibility, stripeRefundIdempotencyKey, validateStripeRefundAmount } from "../services/stripeRefund.service";
import { getInvoiceFinancialPaymentEligibility } from "../../shared/paymentOrchestration";

// Minimal helper (matches server/routes.ts behavior)
function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function getRequestOrganizationId(req: any): string | undefined {
  return req.organizationId || (req.headers["x-organization-id"] as string);
}

function paymentsDebugLogsEnabled(): boolean {
  return String(process.env.PAYMENTS_DEBUG_LOGS || '').trim() === '1';
}

function getInvoiceEmailPublicWebOrigin(): string | null {
  const configured = getPublicWebOrigin() || String(process.env.APP_URL || "").trim() || null;
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

const IMPORTED_QB_PAYMENT_RECONCILIATION_MESSAGE = 'Payments for imported QuickBooks invoices should be reconciled from QuickBooks until payment sync is enabled.';

function isImportedQuickBooksInvoice(invoice: Record<string, any> | null | undefined): boolean {
  return String(invoice?.importSource || '').trim().toLowerCase() === 'quickbooks';
}

function toInvoiceAccountingPayments(paymentRows: Array<Record<string, any>> | undefined) {
  return (paymentRows || []).map((payment) => ({
    id: payment.id,
    status: payment.status,
    amountCents: Number(payment.amountCents || 0),
    syncStatus: payment.syncStatus,
    externalAccountingId: payment.externalAccountingId,
    qbReconciledAt: payment.qbReconciledAt,
  }));
}

function withNormalizedInvoiceDisplay<T extends Record<string, any>>(invoice: T, paymentRows?: Array<Record<string, any>>) {
  return {
    ...invoice,
    ...normalizeInvoiceAccountingDisplay({
      ...invoice,
      payments: paymentRows ? toInvoiceAccountingPayments(paymentRows) : undefined,
    }),
  };
}

function getImportedQuickBooksPaymentBlockReason(invoice: Record<string, any>, paymentRows: Array<Record<string, any>>) {
  if (!isImportedQuickBooksInvoice(invoice)) return null;

  const normalized = withNormalizedInvoiceDisplay(invoice, paymentRows) as any;
  if (Boolean(invoice.isHistorical)) return 'Historical imported QuickBooks invoices cannot accept payments.';
  if (!String(invoice.qbInvoiceId || '').trim()) return 'Imported QuickBooks invoice is missing its QuickBooks Invoice ID.';
  if (String(invoice.status || '').trim().toLowerCase() === 'void') return 'Cannot pay a void invoice';
  if (Number(normalized.displayRemainingCents || 0) <= 0) return 'Invoice is already paid';
  return null;
}

async function getQuickBooksSyncPolicyForOrganization(organizationId: string): Promise<QuickBooksSyncPolicy> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const rawPreferences = (org?.settings as any)?.preferences;
  const preferences = rawPreferences && typeof rawPreferences === "object" ? rawPreferences : {};
  return resolveQuickBooksPreferencesFromOrgPreferences(preferences).syncPolicy;
}

function logStripeCreateIntentDebug(params: {
  event:
    | 'stripe.create_intent.reuse_pending'
    | 'stripe.create_intent.reconcile_pending_succeeded'
    | 'stripe.create_intent.create_new';
  orgId: string;
  invoiceId: string;
  paymentId: string;
  stripePaymentIntentId: string;
  amountCents: number;
}) {
  if (!paymentsDebugLogsEnabled()) return;
  console.log(
    `event=${params.event} orgId=${params.orgId} invoiceId=${params.invoiceId} paymentId=${params.paymentId} hasStripePaymentIntentId=${Boolean(params.stripePaymentIntentId)} amountCents=${params.amountCents}`
  );
}

function extractQuickBooksErrorMessage(err: any): { message: string; statusCode: number } {
  const statusCode = Number(err?.statusCode || 500);

  const raw = String(err?.message || err || '').trim();
  if (!raw) return { message: 'QuickBooks sync failed', statusCode };

  // If the message contains embedded JSON (legacy "QuickBooks API error: <status> { ... }") attempt to extract Fault.Error[0].
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    const maybeJson = raw.slice(jsonStart);
    try {
      const parsed = JSON.parse(maybeJson);
      const qbError = parsed?.Fault?.Error?.[0];
      const messagePart = qbError?.Message ? String(qbError.Message) : '';
      const detailPart = qbError?.Detail ? String(qbError.Detail) : '';
      const combined = [messagePart, detailPart].filter(Boolean).join(' - ');
      if (combined) return { message: combined, statusCode };
    } catch {
      // ignore
    }
  }

  return { message: raw.slice(0, 800), statusCode };
}

function toOneLineHumanMessage(input: unknown, maxLen = 220): string {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'QuickBooks sync failed';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

export async function registerMvpInvoicingRoutes(
  app: Express,
  deps: {
    isAuthenticated: any;
    tenantContext: any;
    requireOrgOwnerAdmin?: any;
  }
) {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin } = deps;

  async function finalizeInvoiceForOperations(input: {
    organizationId: string;
    invoiceId: string;
    userId?: string | null;
    userName?: string | null;
  }) {
    if (!input.userId) throw Object.assign(new Error("Missing user"), { statusCode: 401 });
    return canonicalInvoiceOperations.finalize({
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      actorUserId: input.userId,
      actorUserName: input.userName,
    });
  }

  async function resolveInvoiceEmailRecipientsForOperations(input: {
    organizationId: string;
    invoiceId: string;
  }): Promise<{
    invoice: any;
    customer: any;
    recipients: InvoiceEmailRecipient[];
    defaultRecipient: InvoiceEmailRecipient | null;
  }> {
    const rel = await getInvoiceWithRelations(input.invoiceId);
    if (!rel || rel.invoice.organizationId !== input.organizationId) {
      throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    }

    const invoice: any = rel.invoice;
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, invoice.customerId), eq(customers.organizationId, input.organizationId)))
      .limit(1);
    if (!customer) throw Object.assign(new Error("Customer not found"), { statusCode: 404 });

    let orderContact: { firstName: string; lastName: string; email: string | null } | null = null;
    if (invoice.orderId) {
      const [order] = await db
        .select({ contactId: orders.contactId })
        .from(orders)
        .where(and(eq(orders.id, invoice.orderId), eq(orders.organizationId, input.organizationId)))
        .limit(1);

      if (order?.contactId) {
        const [contact] = await db
          .select({ firstName: customerContacts.firstName, lastName: customerContacts.lastName, email: customerContacts.email })
          .from(customerContacts)
          .where(and(eq(customerContacts.id, order.contactId), eq(customerContacts.organizationId, input.organizationId)))
          .limit(1);
        orderContact = contact ?? null;
      }
    }

    const linkedContacts = await db
      .select({
        firstName: customerContacts.firstName,
        lastName: customerContacts.lastName,
        email: customerContacts.email,
        isPrimary: customerContactLinks.isPrimary,
      })
      .from(customerContactLinks)
      .innerJoin(customerContacts, and(
        eq(customerContactLinks.contactId, customerContacts.id),
        eq(customerContacts.organizationId, input.organizationId),
      ))
      .where(and(
        eq(customerContactLinks.organizationId, input.organizationId),
        eq(customerContactLinks.customerId, customer.id),
        eq(customerContactLinks.status, "active"),
        eq(customerContacts.status, "active"),
      ))
      .orderBy(desc(customerContactLinks.isPrimary), customerContacts.firstName, customerContacts.lastName);

    const contactName = (contact: { firstName: string; lastName: string }) =>
      `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Contact";
    const primaryContacts = linkedContacts.filter((contact) => contact.isPrimary);
    const otherContacts = linkedContacts.filter((contact) => !contact.isPrimary);
    const recipients = buildInvoiceEmailRecipients([
      ...(orderContact ? [{ email: orderContact.email, name: contactName(orderContact), source: "order_contact" as const }] : []),
      ...primaryContacts.map((contact) => ({
        email: contact.email,
        name: contactName(contact),
        source: "customer_primary_contact" as const,
      })),
      { email: customer.email, name: customer.companyName || "Customer account", source: "customer_account" as const },
      ...otherContacts.map((contact) => ({
        email: contact.email,
        name: contactName(contact),
        source: "customer_contact" as const,
      })),
    ]);

    return { invoice, customer, recipients, defaultRecipient: recipients[0] ?? null };
  }

  async function sendInvoiceEmailForOperations(input: {
    organizationId: string;
    invoiceId: string;
    userId?: string | null;
    userName?: string | null;
    toEmail?: string | null;
  }) {
    const emailConfig = await storage.getDefaultEmailSettings(input.organizationId);
    if (!emailConfig) {
      throw Object.assign(
        new Error("Email is not configured. Please configure email settings in the admin panel before sending invoices."),
        { statusCode: 400 },
      );
    }

    const requestedRecipient = input.toEmail == null ? null : String(input.toEmail).trim();
    if (requestedRecipient && !isValidInvoiceRecipientEmail(requestedRecipient)) {
      throw Object.assign(new Error("Enter a valid recipient email address"), { statusCode: 400 });
    }
    if (input.toEmail != null && !requestedRecipient) {
      throw Object.assign(new Error("Enter a valid recipient email address"), { statusCode: 400 });
    }

    const recipientResolution = await resolveInvoiceEmailRecipientsForOperations({
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
    });
    let inv: any = recipientResolution.invoice;
    const cust: any = recipientResolution.customer;
    const recipientEmail = requestedRecipient || recipientResolution.defaultRecipient?.email || null;
    if (!recipientEmail) {
      throw Object.assign(new Error("No recipient email is available. Enter another email address before sending."), { statusCode: 400 });
    }

    const startingStatus = String(inv.status || "").toLowerCase();
    if (startingStatus === "void") throw Object.assign(new Error("Void invoices cannot be sent"), { statusCode: 400 });
    if (startingStatus === "paid") throw Object.assign(new Error("Paid invoices do not need to be sent"), { statusCode: 400 });
    if (startingStatus === "draft") {
      await finalizeInvoiceForOperations(input);
      const finalized = await getInvoiceWithRelations(input.invoiceId);
      if (!finalized || finalized.invoice.organizationId !== input.organizationId) {
        throw Object.assign(new Error("Invoice not found after finalize"), { statusCode: 404 });
      }
      inv = finalized.invoice as any;
    }

    const [orgCompany] = await db.select().from(companySettings).where(eq(companySettings.organizationId, input.organizationId));
    const lineItems = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, inv.id))
      .orderBy(invoiceLineItems.sortOrder, desc(invoiceLineItems.createdAt));

    const orderContext = await getInvoiceOrderContext({
      organizationId: input.organizationId,
      orderId: inv.orderId,
    });
    const job = orderContext
      ? { poNumber: orderContext.poNumber, jobNumber: orderContext.orderNumber, jobLabel: orderContext.jobLabel }
      : null;

    const paymentRows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, input.organizationId)))
      .orderBy(desc(payments.createdAt));

    const rollup = computeInvoicePaymentRollup({
      invoiceTotalCents: Number((inv as any).totalCents || 0),
      payments: paymentRows.map((p: any) => ({
        id: p.id,
        status: String(p.status || "succeeded"),
        amountCents: Number(p.amountCents || 0),
      })),
    });
    const statusLabel = getInvoicePaymentStatusLabel({ invoiceStatus: (inv as any).status, rollup });

    const pdfBytes = await generateInvoicePdfBytes({
      invoice: inv as any,
      customer: (cust as any) || null,
      companySettings: (orgCompany as any) || null,
      paymentSummary: {
        amountPaidCents: rollup.amountPaidCents,
        amountDueCents: rollup.amountDueCents,
        statusLabel,
      },
      lineItems: lineItems as any,
      job,
    });

    const invoiceNumber = (inv as any).displayNumber || ((inv as any).invoiceNumber ? String((inv as any).invoiceNumber) : inv.id);
    const filename = `invoice-${invoiceNumber}.pdf`;
    let pdfAttachment;
    try {
      pdfAttachment = await createInvoicePdfEmailAttachment({ filename, pdfBytes });
    } catch (error) {
      console.error("[Invoice Send] PDF attachment validation failed", {
        invoiceId: input.invoiceId,
        organizationId: input.organizationId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const canInvoiceBePaidOnline = getInvoiceFinancialPaymentEligibility({
      invoiceStatus: (inv as any).status,
      remainingCents: rollup.amountDueCents,
    }).payable;
    const portalUrl = await prepareSingleContactPortalAccessForInvoice({
      organizationId: input.organizationId,
      customerId: inv.customerId,
      recipientEmail,
      actorUserId: input.userId,
    });
    let paymentUrl: string | null = null;
    if (canInvoiceBePaidOnline) {
      const [portalAccessRows, paymentSettings, stripeReadiness] = await Promise.all([
        db
          .select({ email: customerPortalAccess.email })
          .from(customerPortalAccess)
          .where(and(
            eq(customerPortalAccess.organizationId, input.organizationId),
            eq(customerPortalAccess.customerId, inv.customerId),
            eq(customerPortalAccess.status, "ACTIVE"),
          )),
        getPaymentSettings(input.organizationId),
        resolveStripeReadiness(input.organizationId),
      ]);

      const recipientHasPortalAccess = portalAccessRows.some(
        (access) => String(access.email || "").trim().toLowerCase() === String(recipientEmail).trim().toLowerCase(),
      );
      const stripeConnected = paymentSettings.stripeEnabled && stripeReadiness.readyForPayments;
      const availableProviders = [
        stripeConnected ? "stripe" : null,
        paymentSettings.epsReady ? "eps" : null,
      ].filter((provider): provider is HostedPaymentProvider => provider === "stripe" || provider === "eps");
      const hostedPaymentResolution = resolveHostedPaymentProvider({
        configuredDefaultProvider: paymentSettings.provider,
        availableProviders,
      });

      // The portal payment screen currently supports Stripe. Do not create an
      // EPS session while merely composing an email, and never include a link
      // that the recipient cannot use through their existing portal access.
      paymentUrl = buildInvoicePortalPaymentUrl({
        publicWebOrigin: getInvoiceEmailPublicWebOrigin(),
        invoiceId: inv.id,
        canPayOnline: recipientHasPortalAccess && hostedPaymentResolution.provider === "stripe",
      });
    }

    const companyName = orgCompany?.companyName || "QuoteVaultPro";
    const customerName = cust.companyName || cust.email || "Valued Customer";
    const totalFormatted = (Number(inv.totalCents || 0) / 100).toFixed(2);
    const dueDate = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "upon receipt";
    const emailHtml = buildInvoiceEmailHtml({
      invoiceNumber,
      companyName,
      customerName,
      totalFormatted,
      dueDate,
      poNumber: orderContext?.poNumber,
      jobLabel: orderContext?.jobLabel,
      paymentUrl,
      portalUrl,
    });

    const now = new Date();
    let messageId: string | null = null;
    try {
      messageId = await emailService.sendEmail(input.organizationId, {
        to: recipientEmail,
        subject: `Invoice #${invoiceNumber} from ${companyName}`,
        html: emailHtml,
        attachments: [
          pdfAttachment,
        ] as any,
      });

      await createInvoiceEmailLog({
        organizationId: input.organizationId,
        invoiceId: input.invoiceId,
        recipientEmail,
        status: "sent",
        type: "invoice_send",
        messageId,
        sentAt: now,
      });
    } catch (sendError) {
      try {
        await createInvoiceEmailLog({
          organizationId: input.organizationId,
          invoiceId: input.invoiceId,
          recipientEmail,
          status: "failed",
          type: "invoice_send",
          messageId: null,
          sentAt: now,
        });
      } catch (logError) {
        console.error("[Invoice Send] Failed to write failed email log:", logError);
      }
      throw sendError;
    }

    const invoiceVersion = Number(inv.invoiceVersion || 1);
    const currentStatus = String(inv.status || "").toLowerCase();
    const nextStatus = ["paid", "partially_paid", "void"].includes(currentStatus) ? currentStatus : "sent";
    await db
      .update(invoices)
      .set({
        status: nextStatus,
        lastSentAt: now,
        lastSentVersion: invoiceVersion,
        lastSentVia: "email",
        updatedAt: now,
      } as any)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId)));

    if (inv.orderId) {
      const { applyWorkflowStatusPillFailSoft } = await import("../services/workflowStatusPillService");
      await applyWorkflowStatusPillFailSoft({
        organizationId: input.organizationId,
        orderId: String(inv.orderId),
        triggerKey: "invoice_finalized",
        actorUserId: String(input.userId || inv.createdByUserId),
        actorUserName: input.userName || "System",
        source: "system",
        reason: "Invoice sent",
        metadata: { invoiceId: inv.id, invoiceStatus: nextStatus },
      });
    }

    try {
      await db.insert(auditLogs).values(buildInvoiceEmailSentAudit({
        organizationId: input.organizationId,
        invoiceId: input.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        actorUserId: input.userId,
        actorName: input.userName,
        recipientEmail,
        invoiceVersion,
        messageId,
        sentAt: now,
      }) as any);
    } catch (auditError) {
      console.error("Audit log failed:", auditError);
    }

    return {
      invoiceId: input.invoiceId,
      invoiceNumber,
      recipientEmail,
      messageId,
      status: nextStatus,
    };
  }

  // The browser configuration is scoped to an authorized invoice, rather than
  // trusting an account/org supplied by a client. It must be fetched before a
  // PaymentIntent is created so missing platform browser config cannot orphan
  // a pending payment attempt.
  app.get("/api/invoices/:id/payments/stripe/runtime-config", isAuthenticated, tenantContext, ...(requireOrgOwnerAdmin ? [requireOrgOwnerAdmin] : []), async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel || (rel.invoice as any).organizationId !== organizationId) {
        return res.status(404).json({ success: false, error: "Invoice not found" });
      }

      const runtimeConfig = await resolveStripeRuntimeConfig(organizationId);
      if (!runtimeConfig.ok) {
        return res.status(409).json({ success: false, error: runtimeConfig.error, code: runtimeConfig.code });
      }

      return res.json({ success: true, data: runtimeConfig.data });
    } catch (error: any) {
      console.error("[StripeRuntimeConfig] staff invoice configuration failed", { message: String(error?.message || error) });
      return res.status(500).json({ success: false, error: "Unable to prepare Stripe payment configuration" });
    }
  });

  // ------------------------------------------------------------
  // Stripe: Create PaymentIntent for invoice (full payment only)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/payments/stripe/create-intent", isAuthenticated, tenantContext, ...(requireOrgOwnerAdmin ? [requireOrgOwnerAdmin] : []), async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      // Defense in depth: this repeats the preflight used by the browser, so a
      // direct request cannot create an intent without valid platform browser
      // configuration or with a stale tenant account context.
      const runtimeConfig = await resolveStripeRuntimeConfig(organizationId);
      if (!runtimeConfig.ok) {
        return res.status(409).json({ success: false, error: runtimeConfig.error, code: runtimeConfig.code });
      }
      const stripeAccountId = runtimeConfig.data.connectedAccountId;

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ success: false, error: "Missing user" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ success: false, error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ success: false, error: "Invoice not found" });

      const paymentRows = await db
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const importedPaymentBlockReason = getImportedQuickBooksPaymentBlockReason(inv, paymentRows as any);
      if (importedPaymentBlockReason) {
        return res.status(409).json({
          success: false,
          error: importedPaymentBlockReason,
          code: 'IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED',
        });
      }

      const normalizedInvoice = withNormalizedInvoiceDisplay(inv, paymentRows as any) as any;
      const amountDueCents = Number(normalizedInvoice.displayRemainingCents || 0);
      const paymentEligibility = getInvoiceFinancialPaymentEligibility({ invoiceStatus: inv.status, remainingCents: amountDueCents });
      if (!paymentEligibility.payable) {
        return res.status(400).json({ success: false, error: paymentEligibility.blockedReason || "Invoice cannot accept payment" });
      }

      const currency = String(inv.currency || 'USD');

      // A changed invoice balance does not make an earlier PaymentIntent safe
      // to ignore. Verify its Stripe state before offering a second amount.
      const [differentAmountPending] = await db
        .select({ id: payments.id, stripePaymentIntentId: payments.stripePaymentIntentId })
        .from(payments)
        .where(and(
          eq(payments.organizationId, organizationId),
          eq(payments.invoiceId, inv.id),
          eq(payments.provider, 'stripe'),
          eq(payments.status, 'pending'),
          ne(payments.amountCents, amountDueCents),
        ))
        .orderBy(desc(payments.createdAt))
        .limit(1);
      if (differentAmountPending?.stripePaymentIntentId) {
        try {
          const stripe = getStripeClient();
          const pi = await stripe.paymentIntents.retrieve(String(differentAmountPending.stripePaymentIntentId), { stripeAccount: stripeAccountId } as any);
          const piStatus = String((pi as any).status || '').toLowerCase();
          if (piStatus === 'succeeded') {
            await captureAndApplyStripeObservation({
              eventId: `stripe-browser-create:${differentAmountPending.stripePaymentIntentId}:payment_intent.succeeded`,
              type: 'payment_intent.succeeded', organizationId, invoiceId: inv.id,
              paymentIntentId: String(differentAmountPending.stripePaymentIntentId), stripeAccountId,
              amountCents: Math.max(0, Math.round(Number((pi as any).amount_received ?? (pi as any).amount ?? 0))),
              currency: String((pi as any).currency || currency), occurredAt: new Date(),
            });
            return res.status(409).json({ success: false, error: 'Invoice is already paid' });
          }
          if (piStatus !== 'canceled' && piStatus !== 'failed') {
            return res.status(409).json({ success: false, code: 'STRIPE_PENDING_AMOUNT_MISMATCH', error: 'A previous Stripe payment is still awaiting completion.' });
          }
          await db.update(payments).set({
            status: piStatus === 'failed' ? 'failed' : 'canceled',
            ...(piStatus === 'failed' ? { failedAt: new Date() } : { canceledAt: new Date() }),
            updatedAt: new Date(),
          } as any).where(and(eq(payments.id, differentAmountPending.id), eq(payments.organizationId, organizationId)));
        } catch (error: any) {
          console.error('[StripeCreateIntent] failed to verify different-amount pending intent', { organizationId, invoiceId: inv.id, message: String(error?.message || error) });
          return res.status(502).json({ success: false, error: 'Unable to verify the previous Stripe payment attempt; it was left unchanged.' });
        }
      }

      // Idempotency: reuse existing pending Stripe payment for the same invoice + amountDue.
      const [existingPending] = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.invoiceId, inv.id),
            eq(payments.provider, 'stripe'),
            eq(payments.status, 'pending'),
            eq(payments.amountCents, amountDueCents)
          )
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);

      if (existingPending) {
        const existingIntentId = (existingPending as any).stripePaymentIntentId ? String((existingPending as any).stripePaymentIntentId) : '';
        if (existingIntentId) {
          try {
            const stripe = getStripeClient();
            const pi = await stripe.paymentIntents.retrieve(existingIntentId, { stripeAccount: stripeAccountId } as any);
            const piStatus = String((pi as any).status || '').toLowerCase();

            // If Stripe already succeeded, reconcile to avoid any double-charge path.
            if (piStatus === 'succeeded') {
              logStripeCreateIntentDebug({
                event: 'stripe.create_intent.reconcile_pending_succeeded',
                orgId: organizationId,
                invoiceId: inv.id,
                paymentId: String((existingPending as any).id),
                stripePaymentIntentId: existingIntentId,
                amountCents: amountDueCents,
              });

              await captureAndApplyStripeObservation({
                eventId: `stripe-browser-create:${existingIntentId}:payment_intent.succeeded`,
                type: "payment_intent.succeeded",
                organizationId,
                invoiceId: inv.id,
                paymentIntentId: existingIntentId,
                stripeAccountId,
                amountCents: Math.max(0, Math.round(Number((pi as any).amount_received ?? (pi as any).amount ?? amountDueCents))),
                currency: String((pi as any).currency || currency),
                occurredAt: new Date(),
              });
              return res.status(400).json({ success: false, error: 'Invoice is already paid' });
            }

            if (piStatus !== 'canceled' && (pi as any).client_secret) {
              logStripeCreateIntentDebug({
                event: 'stripe.create_intent.reuse_pending',
                orgId: organizationId,
                invoiceId: inv.id,
                paymentId: String((existingPending as any).id),
                stripePaymentIntentId: existingIntentId,
                amountCents: amountDueCents,
              });

              return res.json({
                success: true,
                data: {
                  clientSecret: String((pi as any).client_secret),
                  paymentId: (existingPending as any).id,
                  stripeAccountId,
                },
              });
            }

            // Not usable: transition existing row out of pending, then continue to create a new PI.
            const now = new Date();
            await db
              .update(payments)
              .set({ status: 'canceled', canceledAt: now, updatedAt: now } as any)
              .where(and(eq(payments.id, (existingPending as any).id), eq(payments.organizationId, organizationId)));
          } catch (err: any) {
            console.error('[StripeCreateIntent] failed to retrieve existing intent', {
              organizationId,
              invoiceId: inv.id,
              paymentId: (existingPending as any).id,
              stripePaymentIntentId: existingIntentId,
              message: String(err?.message || err),
            });
            return res.status(502).json({ success: false, error: "Unable to verify the existing Stripe payment attempt; it was left unchanged." });
          }
        } else {
          // Pending row without intent id should not block payment attempts.
          const now = new Date();
          await db
            .update(payments)
            .set({ status: 'canceled', canceledAt: now, updatedAt: now } as any)
            .where(and(eq(payments.id, (existingPending as any).id), eq(payments.organizationId, organizationId)));
        }
      }

      // The generation is stable for concurrent requests to the same logical
      // attempt, while a Stripe-confirmed terminal attempt advances it for a
      // legitimate retry. Amount-only keys replay canceled attempts forever.
      const terminalAttempts = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(
          eq(payments.organizationId, organizationId),
          eq(payments.invoiceId, inv.id),
          eq(payments.provider, 'stripe'),
          inArray(payments.status, ['failed', 'canceled']),
        ));
      const idempotencyKey = `${organizationId}:${inv.id}:${amountDueCents}:staff:v2:${terminalAttempts.length + 1}`;

      const stripe = getStripeClient();
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountDueCents,
          currency: currency.toLowerCase(),
          description: `Invoice #${inv.invoiceNumber}`,
          automatic_payment_methods: { enabled: true },
          metadata: {
            organizationId,
            invoiceId: inv.id,
            stripeAccountId,
            importedQuickBooksInvoice: isImportedQuickBooksInvoice(inv) ? 'true' : 'false',
            qbInvoiceId: inv.qbInvoiceId || null,
          },
        },
        {
          idempotencyKey,
          stripeAccount: stripeAccountId,
        } as any
      );

      if (!pi.client_secret) throw new Error('Stripe did not return client_secret');

      const paymentIntentId = pi.id;
      const clientSecret = pi.client_secret;

      // If another request already inserted the payment row (Stripe idempotency can cause this), reuse it.
      const [existingByIntent] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, paymentIntentId)))
        .limit(1);

      if (existingByIntent && String((existingByIntent as any).status || '').toLowerCase() === 'pending') {
        logStripeCreateIntentDebug({
          event: 'stripe.create_intent.reuse_pending',
          orgId: organizationId,
          invoiceId: inv.id,
          paymentId: String((existingByIntent as any).id),
          stripePaymentIntentId: paymentIntentId,
          amountCents: amountDueCents,
        });
        return res.json({ success: true, data: { clientSecret, paymentId: (existingByIntent as any).id, stripeAccountId } });
      }
      if (existingByIntent && ['succeeded', 'captured'].includes(String((existingByIntent as any).status || '').toLowerCase())) {
        return res.status(409).json({ success: false, error: 'Invoice is already paid' });
      }

      const now = new Date();
      const insertedRows = await db
        .insert(payments)
        .values({
          organizationId,
          invoiceId: inv.id,
          provider: 'stripe',
          status: 'pending',
          amount: (amountDueCents / 100).toFixed(2),
          amountCents: amountDueCents,
          currency,
          stripePaymentIntentId: paymentIntentId,
          metadata: {
            invoiceId: inv.id,
            organizationId,
            stripeAccountId,
            importedQuickBooksInvoice: isImportedQuickBooksInvoice(inv),
            qbInvoiceId: inv.qbInvoiceId || null,
          },
          method: 'credit_card',
          appliedAt: now,
          createdByUserId: userId,
          syncStatus: 'pending',
          createdAt: now,
          updatedAt: now,
        } as any)
        // Backed by 0026_stripe_payments_v1.sql unique index:
        // payments_org_stripe_payment_intent_id_uidx (organization_id, stripe_payment_intent_id)
        .onConflictDoNothing({ target: [payments.organizationId, payments.stripePaymentIntentId] })
        .returning();

      const payment: any | undefined = insertedRows[0] as any;

      if (!payment) {
        const [existingAfterConflict] = await db
          .select()
          .from(payments)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, paymentIntentId)))
          .limit(1);

        if (existingAfterConflict && String((existingAfterConflict as any).status || '').toLowerCase() === 'pending') {
          logStripeCreateIntentDebug({
            event: 'stripe.create_intent.reuse_pending',
            orgId: organizationId,
            invoiceId: inv.id,
            paymentId: String((existingAfterConflict as any).id),
            stripePaymentIntentId: paymentIntentId,
            amountCents: amountDueCents,
          });
          return res.json({ success: true, data: { clientSecret, paymentId: (existingAfterConflict as any).id, stripeAccountId } });
        }
        if (existingAfterConflict && ['succeeded', 'captured'].includes(String((existingAfterConflict as any).status || '').toLowerCase())) {
          return res.status(409).json({ success: false, error: 'Invoice is already paid' });
        }

        throw new Error('Failed to create payment row');
      }

      logStripeCreateIntentDebug({
        event: 'stripe.create_intent.create_new',
        orgId: organizationId,
        invoiceId: inv.id,
        paymentId: String(payment.id),
        stripePaymentIntentId: paymentIntentId,
        amountCents: amountDueCents,
      });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'payment_intent_created',
          entityType: 'invoice',
          entityId: inv.id,
          entityName: String(inv.invoiceNumber),
          description: 'Stripe PaymentIntent created',
          newValues: { provider: 'stripe', stripePaymentIntentId: paymentIntentId, amountCents: amountDueCents } as any,
          createdAt: now,
        } as any);
      } catch {}

      return res.json({ success: true, data: { clientSecret, paymentId: payment?.id, stripeAccountId } });
    } catch (error: any) {
      console.error('[StripeCreateIntent] failed', {
        invoiceId: String(req?.params?.id || ''),
        organizationId: getRequestOrganizationId(req) || null,
        message: String(error?.message || error),
      });
      return res.status(500).json({ success: false, error: error.message || 'Failed to create payment intent' });
    }
  });

  // ------------------------------------------------------------
  // Confirm Stripe payment (called after client confirmPayment succeeds)
  // Checks PaymentIntent status and updates payment record immediately
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/payments/stripe/confirm", isAuthenticated, tenantContext, ...(requireOrgOwnerAdmin ? [requireOrgOwnerAdmin] : []), async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, error: "Missing user" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ success: false, error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ success: false, error: "Invoice not found" });
      const importedPaymentBlockReason = getImportedQuickBooksPaymentBlockReason(inv, rel.payments as any);
      if (importedPaymentBlockReason) {
        return res.status(409).json({
          success: false,
          error: importedPaymentBlockReason,
          code: 'IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED',
        });
      }

      const { paymentIntentId } = req.body;
      if (!paymentIntentId || typeof paymentIntentId !== 'string') {
        return res.status(400).json({ success: false, error: "Missing paymentIntentId" });
      }

      const paymentSettings = await getPaymentSettings(organizationId);
      if (!paymentSettings.stripeEnabled) {
        return res.status(409).json({ success: false, error: 'Stripe is disabled for this organization.', code: 'STRIPE_NOT_ENABLED' });
      }

      const stripeReadiness = await resolveStripeReadiness(organizationId);
      const stripeAccountId = stripeReadiness.stripeAccountId;
      if (!stripeReadiness.readyForPayments || !stripeAccountId) {
        return res.status(409).json({
          success: false,
          error: stripeReadiness.lastError || 'Stripe is not ready for payments for this organization.',
          code: stripeReadiness.code || 'STRIPE_NOT_READY',
        });
      }

      // Retrieve PaymentIntent from Stripe
      const stripe = getStripeClient();
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: stripeAccountId } as any);
      const piStatus = String((pi as any).status || '').toLowerCase();

      const DEV = process.env.NODE_ENV === 'development';
      if (DEV) {
        console.log('[StripeConfirm] PaymentIntent status check', {
          invoiceId: inv.id,
          paymentIntentId,
          piStatus,
          organizationId,
        });
      }

      // Find the payment record
      const [payment] = await db
        .select()
        .from(payments)
        .where(and(
          eq(payments.organizationId, organizationId),
          eq(payments.invoiceId, inv.id),
          eq(payments.stripePaymentIntentId, paymentIntentId)
        ))
        .limit(1);

      if (!payment) {
        return res.status(404).json({ success: false, error: 'Payment record not found' });
      }

      const currentStatus = String((payment as any).status || '').toLowerCase();

      if (["succeeded", "payment_failed", "requires_payment_method", "canceled"].includes(piStatus)) {
        const type = piStatus === "succeeded"
          ? "payment_intent.succeeded"
          : piStatus === "canceled" ? "payment_intent.canceled" : "payment_intent.payment_failed";
        await captureAndApplyStripeObservation({
          eventId: `stripe-browser-confirm:${paymentIntentId}:${type}`,
          type,
          organizationId,
          invoiceId: inv.id,
          paymentIntentId,
          stripeAccountId,
          amountCents: Math.max(0, Math.round(Number((pi as any).amount_received ?? (pi as any).amount ?? (payment as any).amountCents ?? 0))),
          currency: String((pi as any).currency || (payment as any).currency || "USD"),
          occurredAt: new Date(),
        });
      }

      // Fetch updated invoice with payments for rollup
      const updatedInvoice = await getInvoiceWithRelations(inv.id);
      const paymentRows = await db
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Number(inv.totalCents || 0),
        payments: paymentRows.map((p: any) => ({
          id: p.id,
          status: String(p.status || 'succeeded'),
          amountCents: Number(p.amountCents || 0),
        })),
      });

      return res.json({
        success: true,
        data: {
          paymentStatus: piStatus,
          updated: piStatus === 'succeeded' && currentStatus !== 'succeeded',
          invoice: updatedInvoice?.invoice,
          rollup,
        },
      });
    } catch (error: any) {
      console.error('[StripeConfirm] failed', {
        invoiceId: String(req?.params?.id || ''),
        organizationId: getRequestOrganizationId(req) || null,
        message: String(error?.message || error),
      });
      return res.status(500).json({ success: false, error: error.message || 'Failed to confirm payment' });
    }
  });

  // ------------------------------------------------------------
  // Payments list (invoice-scoped, tenant-scoped)
  // ------------------------------------------------------------
  app.get('/api/invoices/:id/payments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      const rows = await db
        .select({
          payment: payments,
          createdBy: users,
        })
        .from(payments)
        .leftJoin(users, eq(payments.createdByUserId, users.id))
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const data = rows.map((r: any) => {
        const u = r.createdBy as any;
        const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
        return {
          ...(r.payment as any),
          createdBy: u
            ? {
                id: u.id,
                name: name || u.email || null,
                email: u.email || null,
              }
            : null,
        };
      });

      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('Error fetching invoice payments:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch payments' });
    }
  });

  // ------------------------------------------------------------
  // Invoice PDF v1 (tenant-scoped)
  // ------------------------------------------------------------
  app.get('/api/invoices/:id/pdf', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const invoiceId = String(req.params.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'Missing invoice id' });

      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
        .limit(1);

      if (!inv) return res.status(404).json({ error: 'Invoice not found' });

      const orderContext = await getInvoiceOrderContext({ organizationId, orderId: (inv as any).orderId });
      const job = orderContext
        ? { poNumber: orderContext.poNumber, jobNumber: orderContext.orderNumber, jobLabel: orderContext.jobLabel }
        : null;

      const [cust] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, (inv as any).customerId), eq(customers.organizationId, organizationId)))
        .limit(1);

      // Company settings are optional; only include branding fields if present.
      const [orgCompany] = await db
        .select()
        .from(companySettings)
        .where(eq(companySettings.organizationId, organizationId))
        .limit(1);

      const lineItems = await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, inv.id))
        .orderBy(invoiceLineItems.sortOrder, desc(invoiceLineItems.createdAt));

      const paymentRows = await db
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Number((inv as any).totalCents || 0),
        payments: paymentRows.map((p: any) => ({
          id: p.id,
          status: String(p.status || 'succeeded'),
          amountCents: Number(p.amountCents || 0),
        })),
      });

      const statusLabel = getInvoicePaymentStatusLabel({ invoiceStatus: (inv as any).status, rollup });

      const pdfBytes = await generateInvoicePdfBytes({
        invoice: inv as any,
        customer: (cust as any) || null,
        companySettings: (orgCompany as any) || null,
        paymentSummary: {
          amountPaidCents: rollup.amountPaidCents,
          amountDueCents: rollup.amountDueCents,
          statusLabel,
        },
        lineItems: lineItems as any,
        job,
      });

      const invoiceNumber = (inv as any).displayNumber || ((inv as any).invoiceNumber ? String((inv as any).invoiceNumber) : inv.id);
      const filename = `invoice-${invoiceNumber}.pdf`;
      const wantsDownload = String(req.query.download || '') === '1';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Disposition',
        `${wantsDownload ? 'attachment' : 'inline'}; filename="${filename}"`
      );

      return res.status(200).send(Buffer.from(pdfBytes));
    } catch (error: any) {
      console.error('Error generating invoice PDF:', error);
      return res.status(500).json({ error: error.message || 'Failed to generate PDF' });
    }
  });

  // ------------------------------------------------------------
  // Manual payments v1: Record a non-Stripe payment
  // ------------------------------------------------------------
  app.post('/api/invoices/:id/payments/manual', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ error: 'Missing user' });

      const body = z
        .object({
          amountCents: z.coerce.number().int().positive(),
          method: manualPaymentMethodSchema,
          appliedAt: z.string().optional(),
          notes: z.string().max(5000).optional(),
          reference: z.string().max(255).optional(),
        })
        .parse(req.body || {});

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });
      const importedPaymentBlockReason = getImportedQuickBooksPaymentBlockReason(inv, rel.payments as any);
      if (importedPaymentBlockReason) {
        return res.status(409).json({
          error: importedPaymentBlockReason,
          code: 'IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED',
        });
      }

      const status = String(inv.status || '').toLowerCase();
      if (status === 'void') return res.status(400).json({ error: 'Cannot record payment on a void invoice' });

      const appliedAt = body.appliedAt ? new Date(body.appliedAt) : new Date();
      if (Number.isNaN(appliedAt.getTime())) return res.status(400).json({ error: 'Invalid appliedAt' });

      const amountCents = Math.max(0, Math.round(Number(body.amountCents || 0)));
      if (amountCents <= 0) return res.status(400).json({ error: 'amountCents must be > 0' });

      const normalizedBeforePayment = withNormalizedInvoiceDisplay(inv, rel.payments as any) as any;
      const remainingCents = Math.max(0, Math.round(Number(normalizedBeforePayment.displayRemainingCents || 0)));
      if (amountCents > remainingCents) {
        return res.status(400).json({
          error: 'Overpayment not allowed',
          remainingCents,
        });
      }

      if (!(canonicalManualPaymentMethodValues as readonly string[]).includes(body.method)) {
        return res.status(400).json({ error: 'Unsupported manual payment method' });
      }
      const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();
      if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required', code: 'IDEMPOTENCY_KEY_REQUIRED' });

      const canonicalResult = await canonicalPaymentOperations.recordManualPayment({
        organizationId,
        actorUserId: userId,
        invoiceId: inv.id,
        amountCents,
        method: body.method,
        appliedAt,
        notes: body.notes,
        reference: body.reference,
        idempotencyKey: `ui:${idempotencyKey}`,
        source: 'ui',
      });

      return res.json({ success: true, data: canonicalResult });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ error: error.message || 'Invalid request' });
      }
      if (error?.code) {
        const conflictCodes = new Set(['INVOICE_NOT_PAYABLE', 'IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED', 'OVERPAYMENT_NOT_ALLOWED', 'IDEMPOTENCY_KEY_CONFLICT']);
        const notFound = error.code === 'INVOICE_NOT_FOUND' || error.code === 'ORDER_NOT_FOUND';
        return res.status(notFound ? 404 : conflictCodes.has(error.code) ? 409 : Number(error.statusCode || 400)).json({ error: error.message, code: error.code });
      }
      console.error('Error recording manual payment:', error);
      return res.status(500).json({ error: error.message || 'Failed to record manual payment' });
    }
  });

  // ------------------------------------------------------------
  // Manual payments v1: Void (soft-void) a manual payment
  // ------------------------------------------------------------
  app.post('/api/invoices/:id/payments/:paymentId/void', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ error: 'Missing user' });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      const paymentId = String(req.params.paymentId || '');
      if (!paymentId) return res.status(400).json({ error: 'Missing paymentId' });

      const result = await voidManualPaymentCanonical({ organizationId, invoiceId: inv.id, paymentId, userId });
      const paymentRowsAfter = await db.select().from(payments).where(and(
        eq(payments.invoiceId, inv.id),
        eq(payments.organizationId, organizationId),
      ));
      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Number(inv.totalCents || 0),
        payments: paymentRowsAfter.map((p: any) => ({ id: p.id, status: String(p.status || 'succeeded'), amountCents: Number(p.amountCents || 0) })),
      });
      return res.json({ success: true, data: { payment: result.payment, invoice: result.invoice, rollup } });
    } catch (error: any) {
      console.error('Error voiding manual payment:', error);
      return res.status(500).json({ error: error.message || 'Failed to void payment' });
    }
  });

  // ------------------------------------------------------------
  // Stripe refunds: tenant-scoped initiation only. A signed webhook remains
  // authoritative for the immutable negative payment effect and invoice rollup.
  // ------------------------------------------------------------
  app.post('/api/invoices/:invoiceId/payments/:paymentId/stripe/refund', isAuthenticated, tenantContext, ...(requireOrgOwnerAdmin ? [requireOrgOwnerAdmin] : []), async (req: any, res) => {
    let initiatedRequest: any = null;
    let initiatedOrganizationId: string | null = null;
    let initiatedUserId: string | null = null;
    let initiatedUserName: string | null = null;
    const refundInput = z.object({ amountCents: z.number().int().positive().max(99_999_999) }).safeParse(req.body);
    const requestId = String(req.headers['idempotency-key'] || '').trim();
    if (!refundInput.success) return res.status(400).json({ success: false, code: 'STRIPE_REFUND_AMOUNT_REQUIRED', error: 'A positive integer refund amount in cents is required.' });
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
      return res.status(400).json({ success: false, code: 'STRIPE_REFUND_IDEMPOTENCY_KEY_REQUIRED', error: 'A valid Idempotency-Key is required to initiate a refund.' });
    }

    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });
      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;
      if (!userId) return res.status(401).json({ success: false, error: 'Missing user' });
      initiatedOrganizationId = organizationId;
      initiatedUserId = userId;
      initiatedUserName = userName;

      const invoiceId = String(req.params.invoiceId || '').trim();
      const paymentId = String(req.params.paymentId || '').trim();
      const [payment] = await db.select().from(payments).where(and(
        eq(payments.id, paymentId),
        eq(payments.invoiceId, invoiceId),
        eq(payments.organizationId, organizationId),
      )).limit(1);
      if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

      const originalAccountId = String((payment as any).metadata?.stripeAccountId || '').trim();
      const eligibility = getStripeRefundEligibility({ originalPayment: payment as any, refundEffects: [] });
      if (!eligibility.ok) return res.status(409).json({ success: false, code: eligibility.code, error: eligibility.error });
      if (!originalAccountId) {
        return res.status(409).json({ success: false, code: 'STRIPE_REFUND_ORIGINAL_ACCOUNT_MISSING', error: 'The original Stripe connected-account context is missing.' });
      }

      const readiness = await resolveStripeReadiness(organizationId);
      const stripeAccountId = String(readiness.stripeAccountId || '').trim();
      if (!readiness.readyForPayments || !stripeAccountId) {
        return res.status(409).json({ success: false, code: readiness.code || 'STRIPE_NOT_READY', error: readiness.lastError || 'Stripe is not ready for refunds for this organization.' });
      }
      if (stripeAccountId !== originalAccountId) {
        return res.status(409).json({ success: false, code: 'STRIPE_REFUND_CONNECTED_ACCOUNT_MISMATCH', error: 'The connected Stripe account does not match the original payment.' });
      }

      const paymentIntentId = String((payment as any).stripePaymentIntentId || '').trim();
      const stripe = getStripeClient();
      const intent: any = await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: stripeAccountId } as any);
      const intentAmountCents = Math.max(0, Math.round(Number(intent.amount_received ?? intent.amount ?? 0)));
      if (String(intent.status || '').toLowerCase() !== 'succeeded' || intentAmountCents !== Number((payment as any).amountCents || 0) ||
        String(intent.metadata?.organizationId || '') !== organizationId || String(intent.metadata?.invoiceId || '') !== invoiceId ||
        String(intent.metadata?.stripeAccountId || '') !== stripeAccountId) {
        return res.status(409).json({ success: false, code: 'STRIPE_REFUND_PAYMENT_CONTEXT_MISMATCH', error: 'The original Stripe payment could not be verified for this invoice and connected account.' });
      }

      const idempotencyKey = stripeRefundIdempotencyKey({ originalPaymentId: paymentId, requestId });
      const reservation = await db.transaction(async (tx) => {
        // Serialize each original charge's refundable balance while retaining a
        // short transaction: never hold a database lock during a Stripe call.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe-refund:${organizationId}:${paymentId}`}))`);
        const [existing] = await tx.select().from(stripeRefundRequests).where(and(
          eq(stripeRefundRequests.organizationId, organizationId),
          eq(stripeRefundRequests.idempotencyKey, idempotencyKey),
        )).limit(1);
        if (existing) {
          if (String(existing.paymentId) !== paymentId || Number(existing.amountCents) !== refundInput.data.amountCents) {
            throw Object.assign(new Error('Idempotency key was already used for a different refund request.'), { code: 'STRIPE_REFUND_IDEMPOTENCY_CONFLICT' });
          }
          if (String(existing.status || '').toLowerCase() === 'failed') {
            throw Object.assign(new Error('This refund request was rejected. Submit a new request with a new Idempotency-Key after correcting the issue.'), { code: 'STRIPE_REFUND_REQUEST_FAILED' });
          }
          return { request: existing as any, reused: true };
        }

        const refundEffects = await tx.select({ status: payments.status, amountCents: payments.amountCents, metadata: payments.metadata })
          .from(payments)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.invoiceId, invoiceId), eq(payments.provider, 'stripe'), eq(payments.status, 'refunded')));
        const pendingReservations = await tx.select({ amountCents: stripeRefundRequests.amountCents }).from(stripeRefundRequests).where(and(
          eq(stripeRefundRequests.organizationId, organizationId),
          eq(stripeRefundRequests.paymentId, paymentId),
          inArray(stripeRefundRequests.status, ['reserved', 'submitted']),
        ));
        const refreshedEligibility = getStripeRefundEligibility({
          originalPayment: payment as any,
          refundEffects: refundEffects as any,
          pendingReservationCents: pendingReservations.reduce((total, row) => total + Math.max(0, Number(row.amountCents || 0)), 0),
        });
        if (!refreshedEligibility.ok) throw Object.assign(new Error(refreshedEligibility.error), { code: refreshedEligibility.code });
        const amountValidation = validateStripeRefundAmount(refundInput.data.amountCents, refreshedEligibility.remainingCents);
        if (!amountValidation.ok) throw Object.assign(new Error(amountValidation.error), { code: amountValidation.code });

        const [created] = await tx.insert(stripeRefundRequests).values({
          organizationId,
          invoiceId,
          paymentId,
          stripePaymentIntentId: paymentIntentId,
          stripeAccountId,
          amountCents: amountValidation.amountCents,
          currency: String((payment as any).currency || 'USD').toUpperCase(),
          idempotencyKey,
          status: 'reserved',
          createdByUserId: userId,
          metadata: { requestId, originalPaymentId: paymentId },
        } as any).returning();
        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName,
          actionType: 'stripe_refund_initiated',
          entityType: 'invoice_payment',
          entityId: paymentId,
          entityName: invoiceId,
          description: 'Stripe refund initiation reserved; webhook reconciliation is pending.',
          newValues: { invoiceId, paymentId, stripePaymentIntentId: paymentIntentId, amountCents: amountValidation.amountCents, requestId, status: 'reserved' } as any,
          createdAt: new Date(),
        } as any);
        return { request: created as any, reused: false };
      });
      initiatedRequest = reservation.request;

      // Stripe's idempotency layer is intentionally invoked even for a retry
      // after a process interruption. It is the money-moving authority; the
      // local reservation only controls concurrency and auditability.
      const refund: any = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Number(reservation.request.amountCents),
        metadata: {
          organizationId,
          invoiceId,
          paymentId,
          stripeAccountId,
          refundRequestId: String(reservation.request.id),
        },
      }, { stripeAccount: stripeAccountId, idempotencyKey } as any);

      const processorStatus = String(refund.status || '').toLowerCase();
      const terminalFailure = ['failed', 'canceled'].includes(processorStatus);
      await db.transaction(async (tx) => {
        // Never overwrite a webhook-confirmed terminal state. A successful
        // synchronous Stripe response is still merely submitted locally until
        // the signed event is reconciled.
        await tx.update(stripeRefundRequests).set({
          stripeRefundId: String(refund.id || '') || null,
          status: terminalFailure ? 'failed' : 'submitted',
          updatedAt: new Date(),
        } as any).where(and(
          eq(stripeRefundRequests.id, reservation.request.id),
          eq(stripeRefundRequests.organizationId, organizationId),
          eq(stripeRefundRequests.status, 'reserved'),
        ));
        if (!reservation.reused) {
          await tx.insert(auditLogs).values({
            organizationId,
            userId,
            userName,
            actionType: terminalFailure ? 'stripe_refund_rejected' : 'stripe_refund_submitted',
            entityType: 'invoice_payment',
            entityId: paymentId,
            entityName: invoiceId,
            description: terminalFailure ? 'Stripe refund request was rejected before reconciliation.' : 'Stripe refund request submitted; signed webhook reconciliation is pending.',
            newValues: { invoiceId, paymentId, stripePaymentIntentId: paymentIntentId, amountCents: Number(reservation.request.amountCents), requestId, status: terminalFailure ? 'failed' : 'submitted' } as any,
            createdAt: new Date(),
          } as any);
        }
      });

      if (terminalFailure) {
        return res.status(409).json({
          success: false,
          code: 'STRIPE_REFUND_REQUEST_FAILED',
          error: 'Stripe rejected the refund request. No local payment state was changed.',
        });
      }

      return res.status(reservation.reused ? 200 : 202).json({
        success: true,
        data: {
          requestId: String(reservation.request.id),
          paymentId,
          amountCents: Number(reservation.request.amountCents),
          processor: 'stripe',
          status: 'pending_reconciliation',
          reused: reservation.reused,
        },
      });
    } catch (error: any) {
      const code = String(error?.code || '');
      const known = new Set([
        'STRIPE_REFUND_IDEMPOTENCY_CONFLICT', 'STRIPE_REFUND_AMOUNT_EXCEEDS_REMAINING', 'STRIPE_REFUND_AMOUNT_REQUIRED',
        'STRIPE_REFUND_PROVIDER_INVALID', 'STRIPE_REFUND_PAYMENT_NOT_SETTLED', 'STRIPE_REFUND_PAYMENT_INTENT_MISSING', 'STRIPE_REFUND_AMOUNT_INVALID', 'STRIPE_REFUND_REQUEST_FAILED',
      ]);
      if (known.has(code)) return res.status(409).json({ success: false, code, error: error.message });
      // A known Stripe validation/permission failure definitively created no
      // refund, so release the reservation. Network/timeout failures are left
      // reserved: retrying the same Idempotency-Key is the only safe outcome.
      const terminalStripeError = ['StripeInvalidRequestError', 'StripePermissionError'].includes(String(error?.type || error?.name || ''));
      if (terminalStripeError && initiatedRequest && initiatedOrganizationId) {
        try {
          await db.transaction(async (tx) => {
            await tx.update(stripeRefundRequests).set({ status: 'failed', updatedAt: new Date() } as any).where(and(
              eq(stripeRefundRequests.id, initiatedRequest.id),
              eq(stripeRefundRequests.organizationId, initiatedOrganizationId!),
              inArray(stripeRefundRequests.status, ['reserved', 'submitted']),
            ));
            await tx.insert(auditLogs).values({
              organizationId: initiatedOrganizationId!, userId: initiatedUserId, userName: initiatedUserName,
              actionType: 'stripe_refund_rejected', entityType: 'invoice_payment', entityId: String(initiatedRequest.paymentId), entityName: String(initiatedRequest.invoiceId),
              description: 'Stripe rejected the refund request before reconciliation.',
              newValues: { paymentId: initiatedRequest.paymentId, stripePaymentIntentId: initiatedRequest.stripePaymentIntentId, amountCents: initiatedRequest.amountCents, requestId: initiatedRequest.metadata?.requestId, status: 'failed' } as any,
              createdAt: new Date(),
            } as any);
          });
        } catch (auditError: any) {
          console.error('[StripeRefund] terminal failure audit update failed', { message: String(auditError?.message || auditError) });
        }
      }
      console.error('[StripeRefund] initiation failed', { organizationId: getRequestOrganizationId(req), invoiceId: req.params.invoiceId, paymentId: req.params.paymentId, code, message: String(error?.message || error) });
      return res.status(502).json({ success: false, code: 'STRIPE_REFUND_INITIATION_FAILED', error: 'Unable to initiate the Stripe refund. No local payment state was changed.' });
    }
  });

  // ------------------------------------------------------------
  // Stripe webhook (no auth) - idempotent + fail-soft
  // Uses req.rawBody (captured by express.json verify in server/index.ts)
  // ------------------------------------------------------------
  app.post('/api/payments/stripe/webhook', async (req: any, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') return res.status(400).send('Missing stripe-signature');

    let event: any;
    try {
      const stripe = getStripeClient();
      const webhookSecret = getStripeWebhookSecret();
      const rawBody: Buffer = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody || '');
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      console.error('[StripeWebhook] signature verification failed:', err);
      return res.status(400).send('Invalid signature');
    }

    const provider = 'stripe';
    const eventId = String(event.id);
    const type = String(event.type);
    const receivedAt = new Date();

    const stripeAccountIdFromEvent = event?.account ? String(event.account) : null;

    // Attempt to extract orgId from metadata (if available)
    const obj: any = event?.data?.object;
    const orgFromMetadata = obj?.metadata?.organizationId ? String(obj.metadata.organizationId) : null;

    let resolvedOrganizationId: string | null = orgFromMetadata;
    if (!resolvedOrganizationId && stripeAccountIdFromEvent) {
      const [conn] = await db
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.provider, 'stripe'), eq(integrationConnections.externalAccountId, stripeAccountIdFromEvent)))
        .limit(1);
      resolvedOrganizationId = conn?.organizationId ? String(conn.organizationId) : null;
    }

    try {
      await db
        .insert(paymentWebhookEvents)
        .values({
          provider,
          eventId,
          type,
          organizationId: resolvedOrganizationId,
          status: 'received',
          receivedAt,
          payload: event as any,
        } as any)
        .onConflictDoNothing({ target: [paymentWebhookEvents.provider, paymentWebhookEvents.eventId] });

      const [existing] = await db
        .select()
        .from(paymentWebhookEvents)
        .where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventId, eventId)))
        .limit(1);

      if (existing?.processedAt && String(existing.status) === 'processed') {
        return res.json({ received: true });
      }

      // Process events
      if (type === 'payment_intent.succeeded') {
        const pi: any = obj;
        const intentId = String(pi.id);
        const invoiceId = pi?.metadata?.invoiceId ? String(pi.metadata.invoiceId) : null;
        const organizationId = pi?.metadata?.organizationId ? String(pi.metadata.organizationId) : resolvedOrganizationId;
        const stripeAccountId = stripeAccountIdFromEvent || (pi?.metadata?.stripeAccountId ? String(pi.metadata.stripeAccountId) : null);

        if (!invoiceId || !organizationId) {
          console.error('[StripeWebhook] missing metadata', {
            eventId,
            type,
            hasStripePaymentIntentId: !!intentId,
            hasInvoiceId: !!invoiceId,
            hasOrganizationId: !!organizationId,
            hasStripeAccountId: !!stripeAccountId,
          });
          throw new Error('Missing invoiceId/organizationId in PaymentIntent metadata');
        }

        if (stripeAccountId) {
          const [conn] = await db
            .select()
            .from(integrationConnections)
            .where(and(eq(integrationConnections.provider, 'stripe'), eq(integrationConnections.externalAccountId, stripeAccountId)))
            .limit(1);

          if (!conn || String(conn.organizationId) !== String(organizationId)) {
            console.error('[StripeWebhook] stripeAccountId org mismatch', {
              eventId,
              type,
              hasStripeAccountId: !!stripeAccountId,
              organizationId,
              resolvedOrganizationId,
            });
            throw new Error('Stripe account does not match organization');
          }
        }

        const amountCents = Math.max(0, Math.round(Number(pi.amount_received ?? pi.amount ?? 0)));
        const currency = String(pi.currency || 'usd').toUpperCase();
        const now = new Date();

        await captureAndApplyStripeObservation({
          eventId,
          type,
          organizationId,
          invoiceId,
          paymentIntentId: intentId,
          stripeAccountId,
          amountCents,
          currency,
          occurredAt: receivedAt,
        });
        return res.json({ received: true });

        const matches = await db
          .select()
          .from(payments)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, intentId)))
          .limit(2);

        const paymentRow: any = matches[0];

        if (!paymentRow) {
          // Recovery path: insert succeeded payment row if missing
          const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId))).limit(1);
          if (!inv) {
            console.error('[StripeWebhook] invoice not found for succeeded intent', {
              eventId,
              type,
              organizationId,
              invoiceId,
              hasStripePaymentIntentId: !!intentId,
            });
            throw new Error('Invoice not found for webhook metadata');
          }

          try {
            await db.insert(payments).values({
              organizationId,
              invoiceId,
              provider: 'stripe',
              status: 'succeeded',
              amount: (amountCents / 100).toFixed(2),
              amountCents,
              currency,
              stripePaymentIntentId: intentId,
              method: 'credit_card',
              paidAt: now,
              succeededAt: now,
              metadata: { paymentIntent: { id: intentId }, stripeAccountId },
              createdByUserId: null,
              syncStatus: 'pending',
              createdAt: now,
              updatedAt: now,
            } as any);
          } catch (insertErr: any) {
            console.error('[StripeWebhook] recovery insert failed', {
              eventId,
              type,
              organizationId,
              invoiceId,
              hasStripePaymentIntentId: !!intentId,
              message: String(insertErr?.message || insertErr),
            });
            throw insertErr;
          }
        } else {
          // Idempotent transition
          const currentStatus = String(paymentRow.status || '').toLowerCase();
          if (currentStatus !== 'succeeded') {
            await db
              .update(payments)
              .set({ status: 'succeeded', paidAt: now, succeededAt: now, updatedAt: now } as any)
              .where(eq(payments.id, paymentRow.id));
          }
        }

        // Refresh invoice rollup (status-aware)
        await refreshInvoiceStatus(invoiceId);

        // Best-effort audit
        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: null,
            userName: 'stripe_webhook',
            actionType: 'payment_succeeded',
            entityType: 'invoice',
            entityId: invoiceId,
            entityName: String(invoiceId),
            description: 'Stripe payment succeeded (webhook)',
            newValues: { stripePaymentIntentId: intentId, amountCents } as any,
            createdAt: now,
          } as any);
        } catch {}
      } else if (type === 'payment_intent.payment_failed') {
        const pi: any = obj;
        const intentId = String(pi.id);
        const organizationId = pi?.metadata?.organizationId ? String(pi.metadata.organizationId) : resolvedOrganizationId;
        const now = new Date();

        if (!organizationId) {
          console.error('[StripeWebhook] payment_failed missing organizationId', {
            eventId,
            type,
            hasStripePaymentIntentId: !!intentId,
            hasStripeAccountId: !!stripeAccountIdFromEvent,
          });
          throw new Error('Missing organizationId for payment_failed');
        }

        const stripeAccountId = stripeAccountIdFromEvent || (pi?.metadata?.stripeAccountId ? String(pi.metadata.stripeAccountId) : null);
        if (stripeAccountId) {
          const [conn] = await db.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
            eq(integrationConnections.provider, "stripe"),
            eq(integrationConnections.externalAccountId, stripeAccountId),
          )).limit(1);
          if (!conn || String(conn.organizationId) !== String(organizationId)) throw new Error("Stripe account does not match organization");
        }

        await captureAndApplyStripeObservation({
          eventId,
          type,
          organizationId,
          invoiceId: pi?.metadata?.invoiceId ? String(pi.metadata.invoiceId) : null,
          paymentIntentId: intentId,
          stripeAccountId,
          amountCents: Math.max(0, Math.round(Number(pi.amount_received ?? pi.amount ?? 0))),
          currency: String(pi.currency || "USD"),
          occurredAt: now,
        });
        return res.json({ received: true });

        await db
          .update(payments)
          .set({ status: 'failed', failedAt: now, updatedAt: now } as any)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, intentId)));
      } else if (type === 'payment_intent.canceled') {
        const pi: any = obj;
        const intentId = String(pi.id);
        const organizationId = pi?.metadata?.organizationId ? String(pi.metadata.organizationId) : resolvedOrganizationId;
        const now = new Date();

        if (!organizationId) {
          console.error('[StripeWebhook] canceled missing organizationId', {
            eventId,
            type,
            hasStripePaymentIntentId: !!intentId,
            hasStripeAccountId: !!stripeAccountIdFromEvent,
          });
          throw new Error('Missing organizationId for canceled');
        }

        const stripeAccountId = stripeAccountIdFromEvent || (pi?.metadata?.stripeAccountId ? String(pi.metadata.stripeAccountId) : null);
        if (stripeAccountId) {
          const [conn] = await db.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
            eq(integrationConnections.provider, "stripe"),
            eq(integrationConnections.externalAccountId, stripeAccountId),
          )).limit(1);
          if (!conn || String(conn.organizationId) !== String(organizationId)) throw new Error("Stripe account does not match organization");
        }

        await captureAndApplyStripeObservation({
          eventId,
          type,
          organizationId,
          invoiceId: pi?.metadata?.invoiceId ? String(pi.metadata.invoiceId) : null,
          paymentIntentId: intentId,
          stripeAccountId,
          amountCents: Math.max(0, Math.round(Number(pi.amount_received ?? pi.amount ?? 0))),
          currency: String(pi.currency || "USD"),
          occurredAt: now,
        });
        return res.json({ received: true });

        await db
          .update(payments)
          .set({ status: 'canceled', canceledAt: now, updatedAt: now } as any)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, intentId)));
      } else if (type === "refund.created" || type === "refund.updated") {
        const refund: any = obj;
        const organizationId = refund?.metadata?.organizationId ? String(refund.metadata.organizationId) : resolvedOrganizationId;
        const paymentIntentId = String(refund?.payment_intent || refund?.metadata?.paymentIntentId || "");
        if (!organizationId || !paymentIntentId) throw new Error("Stripe refund is missing organization or PaymentIntent identity");
        const stripeAccountId = stripeAccountIdFromEvent || (refund?.metadata?.stripeAccountId ? String(refund.metadata.stripeAccountId) : null);
        if (stripeAccountId) {
          const [conn] = await db.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
            eq(integrationConnections.provider, "stripe"),
            eq(integrationConnections.externalAccountId, stripeAccountId),
          )).limit(1);
          if (!conn || String(conn.organizationId) !== organizationId) throw new Error("Stripe account does not match organization");
        }
        await captureAndApplyStripeObservation({
          eventId,
          type,
          organizationId,
          invoiceId: refund?.metadata?.invoiceId ? String(refund.metadata.invoiceId) : null,
          paymentIntentId,
          stripeAccountId,
          amountCents: Math.max(0, Math.round(Number(refund.amount ?? refund.amount_refunded ?? 0))),
          currency: String(refund.currency || "USD"),
          refundId: refund.id ? String(refund.id) : null,
          refundRequestId: refund?.metadata?.refundRequestId ? String(refund.metadata.refundRequestId) : null,
          refundAmountCents: Math.max(0, Math.round(Number(refund.amount ?? refund.amount_refunded ?? 0))),
          refundStatus: String(refund.status || "succeeded"),
          occurredAt: receivedAt,
        });
        return res.json({ received: true });
      } else {
        // ignore safely
      }

      await db
        .update(paymentWebhookEvents)
        .set({ status: 'processed', processedAt: new Date() } as any)
        .where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventId, eventId)));

      return res.json({ received: true });
    } catch (err: any) {
      console.error('[StripeWebhook] processing failed', {
        eventId,
        type,
        hasStripeAccountId: !!stripeAccountIdFromEvent,
        message: String(err?.message || err),
      });
      try {
        await db
          .update(paymentWebhookEvents)
          .set({ status: 'error', error: String(err?.message || err), processedAt: new Date() } as any)
          .where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventId, eventId)));
      } catch {}
      // Return 500 so Stripe retries (idempotency table prevents double-processing)
      return res.status(500).send('Webhook processing failed');
    }
  });

  // ------------------------------------------------------------
  // Invoices: list/detail (tenant-scoped)
  // ------------------------------------------------------------
  app.get("/api/invoices", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const status = req.query.status as string | undefined;
      const customerId = req.query.customerId as string | undefined;
      const orderId = req.query.orderId as string | undefined;
      const search = req.query.search as string | undefined;
      const sortBy = req.query.sortBy as string | undefined;
      const sortDir = req.query.sortDir as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
      const offset = parseInt((req.query.offset as string) || "0", 10);

      const rows = await listInvoicesForOrganization({
        organizationId,
        status,
        customerId,
        orderId,
        search,
        sortBy,
        sortDir,
        limit,
        offset,
      });

      const emailStatuses = await getInvoiceEmailStatuses(
        rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
        organizationId,
      );

      const invoiceIds = rows.map((row) => row.id);
      const paymentRows = invoiceIds.length > 0
        ? await db
            .select()
            .from(payments)
            .where(and(
              eq(payments.organizationId, organizationId),
              inArray(payments.invoiceId, invoiceIds),
            ))
        : [];
      const paymentsByInvoiceId = new Map<string, Array<Record<string, any>>>();
      for (const payment of paymentRows as any[]) {
        const invoiceId = String(payment.invoiceId || "");
        if (!invoiceId) continue;
        const bucket = paymentsByInvoiceId.get(invoiceId) ?? [];
        bucket.push(payment);
        paymentsByInvoiceId.set(invoiceId, bucket);
      }

      // Batch-fetch reminder list info — shares settings fetch with reminder preview
      const orgSettings = await getInvoiceReminderSettingsForOrg(organizationId);
      const reminderInfoMap = await getInvoiceListReminderInfo(
        rows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          status: row.status,
          dueDate: row.dueDate,
          totalCents: row.totalCents,
          balanceDue: (withNormalizedInvoiceDisplay(row as any, paymentsByInvoiceId.get(row.id) ?? []) as any).displayRemaining.toFixed(2),
          customerName: (row as any).customerName ?? '',
          recipientEmail: null, // not needed for list status derivation
        })),
        organizationId,
        orgSettings,
      );

      res.json({
        success: true,
        data: rows.map((row) => withNormalizedInvoiceDisplay(
          {
            ...row,
            ...(emailStatuses.get(row.id) || {
              lastSentAt: null,
              lastInvoiceEmailRecipient: null,
              emailStatus: 'not_sent' as const,
            }),
            ...(reminderInfoMap.get(row.id) || {
              reminderStatus: 'not_due' as const,
              lastReminderSentAt: null,
              lastReminderRecipient: null,
              nextReminderDueAt: null,
            }),
          },
          paymentsByInvoiceId.get(row.id) ?? [],
        )),
      });
    } catch (error: any) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ error: error.message || "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      if ((rel.invoice as any).organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      const emailTracking = await getInvoiceEmailStatus(req.params.id);
      const normalizedInvoice = withNormalizedInvoiceDisplay({ ...(rel.invoice as any), ...emailTracking }, rel.payments as any);
      const normalizedQuickBooksLines = normalizeQuickBooksLineItemsSnapshot((rel.invoice as any).qbLineItemsSnapshot);

      if (normalizedInvoice.isImportedFromQuickBooks) {
        try {
          const userId = getUserId(req.user);
          const userName = String(req.user?.email || req.user?.claims?.email || req.user?.name || '').trim() || null;
          await storage.createAuditLog(organizationId, {
            userId,
            userName,
            actionType: 'quickbooks_invoice_detail_normalized',
            entityType: 'invoice',
            entityId: String((rel.invoice as any).id || req.params.id),
            entityName: String((rel.invoice as any).qbDocNumber || (rel.invoice as any).invoiceNumber || req.params.id),
            description: 'Normalized QuickBooks invoice detail for display',
            newValues: {
              displayStatus: normalizedInvoice.displayStatus,
              displayPaid: normalizedInvoice.displayPaid,
              displayRemaining: normalizedInvoice.displayRemaining,
              isHistorical: normalizedInvoice.isHistorical,
              accountingSource: normalizedInvoice.accountingSource,
              importedQuickBooksLineItemCount: normalizedQuickBooksLines.lines.length,
            },
            ipAddress: req.ip ?? null,
            userAgent: req.get('user-agent') || null,
          });
        } catch (auditError: any) {
          console.error('[InvoiceDetail] quickbooks_invoice_detail_normalized audit failed:', auditError?.message || auditError);
        }
      }

      res.json({
        success: true,
        data: {
          ...rel,
          invoice: normalizedInvoice,
          importedQuickBooksLineItems: normalizedQuickBooksLines.lines,
          importedQuickBooksLineItemsUnavailableMessage: normalizedQuickBooksLines.unavailableMessage,
        },
      });
    } catch (error: any) {
      console.error("Error fetching invoice:", error);
      res.status(500).json({ error: error.message || "Failed to fetch invoice" });
    }
  });

  // ------------------------------------------------------------
  // Read-only order payment resolution.
  // ------------------------------------------------------------
  app.get("/api/orders/:orderId/payment-resolution", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const data = await resolveOrderPayment({
        organizationId,
        orderId: String(req.params.orderId || ""),
      });

      if (!data) return res.status(404).json({ success: false, error: "Order not found" });
      return res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error resolving order payment:", error);
      return res.status(500).json({ success: false, error: error.message || "Failed to resolve order payment" });
    }
  });

  // ------------------------------------------------------------
  // Preferred: create invoice from order
  // ------------------------------------------------------------
  app.post("/api/orders/:orderId/invoices", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "Missing user" });

      const { orderId } = req.params;
      const { terms, customDueDate } = req.body || {};

      const [order] = await db
        .select({ id: orders.id, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (isCanceledOrder(order)) {
        return res.status(409).json({ error: "Cannot create an invoice from a cancelled order", code: "ORDER_CANCELLED" });
      }

      // Keep the displayed readiness state synchronized, but never use production
      // or fulfillment progress as an invoice gate.
      await recomputeOrderBillingStatus({ organizationId, orderId });

      const invoiceLines = await db
        .select({
          totalPrice: orderLineItems.totalPrice,
          workflowIntent: products.workflowIntent,
          allowZeroPrice: products.allowZeroPrice,
        })
        .from(orderLineItems)
        .leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
        .where(eq(orderLineItems.orderId, orderId));
      const financialEligibility = resolveInvoiceFinancialEligibility(invoiceLines);
      if (!financialEligibility.canCreateInvoice) {
        return res.status(409).json({
          error: financialEligibility.message,
          code: financialEligibility.code,
        });
      }

      const [invoice] = await canonicalInvoiceOperations.createDraftsFromOrders({ organizationId, actorUserId: userId, orderIds: [orderId], terms: terms || "due_on_receipt", customDueDate: customDueDate ? new Date(customDueDate) : null, auditSource: "ui" });

      res.json({ success: true, data: invoice });
    } catch (error: any) {
      console.error("Error creating invoice from order:", error);
      const statusCode = Number(error?.statusCode || 500);
      res.status(Number.isFinite(statusCode) ? statusCode : 500).json({
        error: error.message || "Failed to create invoice",
        code: error.code,
      });
    }
  });

  // ------------------------------------------------------------
  // Finalize invoice (draft -> finalized). QuickBooks sync is explicit only.
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/bill", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      const status = String(inv.status || "").toLowerCase();
      if (status !== "draft") return res.status(400).json({ error: "Only draft invoices can be finalized" });

      await finalizeInvoiceForOperations({ organizationId, invoiceId: inv.id, userId, userName });

      const refreshed = await getInvoiceWithRelations(inv.id);
      res.json({ success: true, data: refreshed });
    } catch (error: any) {
      console.error("Error billing invoice:", error);
      res.status(500).json({ error: error.message || "Failed to bill invoice" });
    }
  });

  // ------------------------------------------------------------
  // Retry QB sync (fail-soft)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/retry-qb-sync", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      await db.update(invoices).set({ qbSyncStatus: "pending", updatedAt: new Date() } as any).where(eq(invoices.id, inv.id));

      try {
        const qb = await syncSingleInvoiceToQuickBooksForOrganization(organizationId, inv.id);
        await db
          .update(invoices)
          .set({ qbInvoiceId: qb.qbInvoiceId, externalAccountingId: qb.qbInvoiceId, qbSyncStatus: "synced", qbLastError: null, syncStatus: "synced", syncError: null, syncedAt: new Date(), lastQbSyncedVersion: Number(inv.invoiceVersion || 1), updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_retried",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync retried (success)",
            createdAt: new Date(),
          } as any);
        } catch {}
      } catch (e: any) {
        await db
          .update(invoices)
          .set({ qbSyncStatus: "failed", qbLastError: String(e?.message || e), syncStatus: "error", syncError: String(e?.message || e), updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_failed",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync retry failed",
            newValues: { error: String(e?.message || e) } as any,
            createdAt: new Date(),
          } as any);
        } catch {}
      }

      const refreshed = await getInvoiceWithRelations(inv.id);
      res.json({ success: true, data: refreshed });
    } catch (error: any) {
      console.error("Error retrying QB sync:", error);
      res.status(500).json({ error: error.message || "Failed to retry QB sync" });
    }
  });

  // ------------------------------------------------------------
  // QuickBooks: explicit sync endpoints (tenant-scoped)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/qb/queue", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ success: false, error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ success: false, error: "Invoice not found" });
      const status = String(inv.status || "").toLowerCase();
      if (status === "draft" || status === "void") {
        return res.status(400).json({ success: false, error: "Only finalized or sent invoices can be queued for QuickBooks" });
      }

      await db
        .update(invoices)
        .set({ qbSyncStatus: "pending", qbLastError: null, updatedAt: new Date() } as any)
        .where(and(eq(invoices.id, inv.id), eq(invoices.organizationId, organizationId)));

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: "invoice_qb_sync_queued",
          entityType: "invoice",
          entityId: inv.id,
          entityName: String(inv.invoiceNumber),
          description: "Invoice queued for QuickBooks sync",
          createdAt: new Date(),
        } as any);
      } catch {}

      const refreshed = await getInvoiceWithRelations(inv.id);
      res.json({ success: true, data: refreshed });
    } catch (error: any) {
      console.error("Error queueing invoice for QB:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to queue invoice for QuickBooks" });
    }
  });

  app.post("/api/invoices/:id/qb/sync", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ success: false, error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ success: false, error: "Invoice not found" });

      await db.update(invoices).set({ qbSyncStatus: "pending", updatedAt: new Date() } as any).where(eq(invoices.id, inv.id));

      try {
        const qb = await syncSingleInvoiceToQuickBooksForOrganization(organizationId, inv.id);
        await db
          .update(invoices)
          .set({ qbInvoiceId: qb.qbInvoiceId, externalAccountingId: qb.qbInvoiceId, qbSyncStatus: "synced", qbLastError: null, syncStatus: "synced", syncError: null, syncedAt: new Date(), lastQbSyncedVersion: Number(inv.invoiceVersion || 1), updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_manual",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync (manual)",
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB invoice sync success:', {
            organizationId,
            invoiceId: inv.id,
            message: String(logErr?.message || logErr),
          });
        }
      } catch (e: any) {
        const extracted = extractQuickBooksErrorMessage(e);
        await db
          .update(invoices)
          .set({ qbSyncStatus: "failed", qbLastError: extracted.message, syncStatus: "error", syncError: extracted.message, updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_failed",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync failed (manual)",
            newValues: { error: extracted.message } as any,
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB invoice sync failure:', {
            organizationId,
            invoiceId: inv.id,
            message: String(logErr?.message || logErr),
          });
        }

        return res.status(extracted.statusCode).json({ success: false, error: extracted.message, code: 'QB_INVOICE_SYNC_FAILED' });
      }

      const refreshed = await getInvoiceWithRelations(inv.id);
      res.json({ success: true, data: refreshed });
    } catch (error: any) {
      console.error("Error syncing invoice to QB:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to sync invoice to QuickBooks" });
    }
  });

  app.post("/api/payments/:id/qb/sync", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const paymentId = String(req.params.id);
      const existing = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)))
        .limit(1);

      const p: any = existing[0];
      if (!p) return res.status(404).json({ success: false, error: "Payment not found" });

      // Future-compatibility guard:
      // This route intentionally assumes one payment applies to one invoice.
      // Multi-invoice and partial payment support will be implemented via
      // a PaymentReceipt + PaymentApplication model in a future milestone.
      const invoiceId = p?.invoiceId ? String(p.invoiceId).trim() : '';
      if (!invoiceId) {
        return res.status(400).json({ success: false, error: 'Payment is missing invoiceId', code: 'PAYMENT_MISSING_INVOICE' });
      }

      const paymentStatus = String(p.status || '').toLowerCase();
      if (paymentStatus !== 'succeeded') {
        return res.status(400).json({ success: false, error: "Only succeeded payments can be synced to QuickBooks" });
      }

      const existingExternalId = p?.externalAccountingId ? String(p.externalAccountingId).trim() : '';
      const existingSyncStatus = String(p?.syncStatus || '').toLowerCase();

      // Idempotency: if already synced (or has external id), do NOT call QuickBooks again.
      if (existingExternalId || existingSyncStatus === 'synced') {
        const now = new Date();
        if (existingExternalId && existingSyncStatus !== 'synced') {
          // Normalize local state to reflect the known external accounting link.
          await db
            .update(payments)
            .set({
              syncStatus: 'synced',
              syncError: null,
              syncedAt: p?.syncedAt || now,
              updatedAt: now,
            } as any)
            .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));
        }

        return res.json({
          success: true,
          message: 'Payment already synced',
          data: { qbPaymentId: existingExternalId || null },
        });
      }

      // Preconditions: QB must be connected and invoice must already be synced (qbInvoiceId).
      const token = await getValidAccessTokenForOrganization(organizationId);
      if (!token) {
        return res.status(409).json({ success: false, error: 'QuickBooks is not connected for this organization', code: 'QB_NOT_CONNECTED' });
      }

      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
        .limit(1);
      if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found for payment' });

      const qbInvoiceId = String((inv as any).qbInvoiceId || '').trim();
      if (!qbInvoiceId) {
        return res.status(409).json({ success: false, error: 'Invoice must be synced to QuickBooks before syncing payments', code: 'QB_INVOICE_NOT_SYNCED' });
      }

      try {
        const qb = await syncSinglePaymentToQuickBooksForOrganization(organizationId, paymentId);

        // MVP canonical storage note:
        // QuickBooks is currently the only external accounting provider, so payments.externalAccountingId holds qbPaymentId.

        await db
          .update(payments)
          .set({
            externalAccountingId: qb.qbPaymentId,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "quickbooks.payment.sync.succeeded",
            entityType: "payment",
            entityId: paymentId,
            entityName: String(p.referenceNumber || paymentId),
            description: "QuickBooks payment sync succeeded (manual)",
            newValues: { qbPaymentId: qb.qbPaymentId } as any,
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB payment sync success:', {
            organizationId,
            paymentId,
            message: String(logErr?.message || logErr),
          });
        }

        return res.json({ success: true, data: { qbPaymentId: qb.qbPaymentId } });
      } catch (e: any) {
        const extracted = extractQuickBooksErrorMessage(e);
        const oneLine = toOneLineHumanMessage(extracted.message);

        await db
          .update(payments)
          .set({
            syncStatus: 'failed',
            syncError: oneLine,
            updatedAt: new Date(),
          } as any)
          .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "quickbooks.payment.sync.failed",
            entityType: "payment",
            entityId: paymentId,
            entityName: String(p.referenceNumber || paymentId),
            description: "QuickBooks payment sync failed (manual)",
            newValues: { error: extracted.message } as any,
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB payment sync failure:', {
            organizationId,
            paymentId,
            message: String(logErr?.message || logErr),
          });
        }

        return res.status(extracted.statusCode).json({ success: false, error: oneLine, code: 'QB_PAYMENT_SYNC_FAILED' });
      }
    } catch (error: any) {
      console.error("Error syncing payment to QB:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to sync payment to QuickBooks" });
    }
  });

  // ------------------------------------------------------------
  // Record payment on invoice (invoice-scoped)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/payments", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ error: "Missing user" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });
      const importedPaymentBlockReason = getImportedQuickBooksPaymentBlockReason(inv, rel.payments as any);
      if (importedPaymentBlockReason) {
        return res.status(409).json({
          error: importedPaymentBlockReason,
          code: 'IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED',
        });
      }

      const { amountCents, amount, method, note, notes } = req.body || {};
      const amt = amountCents !== undefined ? Number(amountCents) / 100 : Number(amount);
      if (!amt || !method) return res.status(400).json({ error: "amountCents/amount and method required" });

      if (!(canonicalManualPaymentMethodValues as readonly string[]).includes(String(method))) return res.status(400).json({ error: "Unsupported manual payment method" });
      const idempotencyKey = String(req.headers["idempotency-key"] || req.body?.idempotencyKey || "").trim();
      if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key header is required", code: "IDEMPOTENCY_KEY_REQUIRED" });
      const result = await canonicalPaymentOperations.recordManualPayment({ organizationId, actorUserId: userId, invoiceId: inv.id, amountCents: Math.round(amt * 100), method, notes: note ?? notes, idempotencyKey: `ui:${idempotencyKey}`, source: "ui" });
      res.json({ success: true, data: result.payment });
    } catch (error: any) {
      console.error("Error recording payment:", error);
      res.status(500).json({ error: error.message || "Failed to record payment" });
    }
  });

  // ------------------------------------------------------------
  // Update invoice (financial edits rules) - tenant-scoped
  // ------------------------------------------------------------
  app.patch("/api/invoices/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const { id } = req.params;
      const existingRel = await getInvoiceWithRelations(id);
      if (!existingRel) return res.status(404).json({ error: "Invoice not found" });
      const existing: any = existingRel.invoice;
      if (existing.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      const existingStatus = String(existing.status || "").toLowerCase();
      const isImportedQuickBooks = isImportedQuickBooksInvoice(existing);
      const isPaid = existingStatus === "paid";
      const isVoid = existingStatus === "void";
      const balanceDue = Number(existing.balanceDue || Number(existing.total) - Number(existing.amountPaid));
      const isBilledUnpaid = existingStatus === "billed" && balanceDue > 0;

      const existingInvoiceVersion = Number(existing.invoiceVersion || 1);

      const requestKeys = Object.keys(req.body || {});
      const forbiddenFinancialKeys = ["subtotalCents", "taxCents", "shippingCents", "totalCents", "subtotal", "tax", "total", "balanceDue", "amountPaid"];
      if (requestKeys.some((key) => forbiddenFinancialKeys.includes(key))) {
        return res.status(400).json({ error: "Invoice financial totals are derived from canonical lines and payments.", code: "INVOICE_FINANCIAL_PATCH_FORBIDDEN" });
      }
      const safeCanonicalKeys = new Set(["terms", "customDueDate", "notesPublic"]);
      if (userId && existingStatus === "draft" && !isImportedQuickBooks && requestKeys.length > 0 && requestKeys.every((key) => safeCanonicalKeys.has(key))) {
        const customDueDate = typeof req.body.customDueDate === "string" ? new Date(req.body.customDueDate) : undefined;
        if (customDueDate && Number.isNaN(customDueDate.getTime())) return res.status(400).json({ error: "Invalid customDueDate" });
        const result = await canonicalInvoiceOperations.updateSafeDraft({
          organizationId,
          actorUserId: userId,
          invoiceId: id,
          patch: {
            ...(typeof req.body.terms === "string" ? { terms: req.body.terms } : {}),
            ...(customDueDate ? { customDueDate } : {}),
            ...(typeof req.body.notesPublic === "string" ? { notesPublic: req.body.notesPublic } : {}),
          } as any,
        });
        return res.json({ success: true, data: result.updated });
      }

      const updates: any = {};
      if (typeof req.body.notesPublic === "string") updates.notesPublic = req.body.notesPublic;
      if (typeof req.body.notesInternal === "string") updates.notesInternal = req.body.notesInternal;
      if (typeof req.body.terms === "string") updates.terms = req.body.terms;

      let nextDueDate: Date | undefined;
      if (typeof req.body.customDueDate === "string") {
        const d = new Date(req.body.customDueDate);
        if (!Number.isNaN(d.getTime())) {
          nextDueDate = d;
          updates.dueDate = d;
        }
      }

      // Customer/customer-visible identity changes
      if (typeof req.body.customerId === "string" && req.body.customerId && req.body.customerId !== existing.customerId) {
        if (isImportedQuickBooks) return res.status(400).json({ error: "Imported QuickBooks invoices are read-only for customer/accounting fields" });
        if (isPaid) return res.status(400).json({ error: "Paid invoices are locked" });
        if (isVoid) return res.status(400).json({ error: "Void invoices are locked" });
        const [targetCustomer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, req.body.customerId), eq(customers.organizationId, organizationId))).limit(1);
        if (!targetCustomer) return res.status(404).json({ error: "Customer not found", code: "CUSTOMER_NOT_FOUND" });
        updates.customerId = req.body.customerId;
      }

      if (isImportedQuickBooks && (typeof req.body.terms === "string" || typeof req.body.customDueDate === "string")) {
        return res.status(400).json({ error: "Imported QuickBooks invoices are read-only for customer/accounting fields" });
      }

      const financialUpdates: any = {};
      const hasFinancialBody = false;
      const hasCustomerChange = typeof req.body.customerId === "string" && req.body.customerId && req.body.customerId !== existing.customerId;
      const hasTermsChange = typeof req.body.terms === "string" && req.body.terms !== existing.terms;

      const existingDueMs = existing.dueDate ? new Date(existing.dueDate as any).getTime() : null;
      const nextDueMs = nextDueDate ? nextDueDate.getTime() : null;
      const hasDueDateChange = nextDueDate !== undefined && existingDueMs !== nextDueMs;

      if (existingStatus !== "draft" && (hasFinancialBody || hasCustomerChange || hasTermsChange || hasDueDateChange)) {
        return res.status(400).json({
          error: "Finalized and sent invoices are locked. Void this invoice or create a revised invoice in a future revision workflow.",
          code: "INVOICE_LOCKED_FINALIZED",
        });
      }

      const nextSubtotalCents = req.body.subtotalCents !== undefined ? Number(req.body.subtotalCents) : Number(existing.subtotalCents || 0);
      const nextTaxCents = req.body.taxCents !== undefined ? Number(req.body.taxCents) : Number(existing.taxCents || 0);
      const nextShippingCents = req.body.shippingCents !== undefined ? Number(req.body.shippingCents) : Number(existing.shippingCents || 0);
      const computedNextTotalCents = Math.max(0, Math.round(nextSubtotalCents) + Math.round(nextTaxCents) + Math.round(nextShippingCents));

      const financialOrCustomerVisibleChanged =
        (hasFinancialBody && (
          Math.round(nextSubtotalCents) !== Number(existing.subtotalCents || 0) ||
          Math.round(nextTaxCents) !== Number(existing.taxCents || 0) ||
          Math.round(nextShippingCents) !== Number(existing.shippingCents || 0) ||
          computedNextTotalCents !== Number(existing.totalCents || 0)
        )) ||
        hasCustomerChange ||
        hasDueDateChange;

      const nextInvoiceVersion = financialOrCustomerVisibleChanged ? existingInvoiceVersion + 1 : existingInvoiceVersion;
      if (financialOrCustomerVisibleChanged) {
        updates.invoiceVersion = nextInvoiceVersion;

        if (String(existing.qbSyncStatus || "") === "synced") {
          // Financial/customer-visible changes invalidate previous accounting sync.
          financialUpdates.qbSyncStatus = "needs_resync";
        }
      }

      if (hasFinancialBody) {
        if (isImportedQuickBooks) return res.status(400).json({ error: "Imported QuickBooks invoices are read-only for customer/accounting fields" });
        if (isPaid) return res.status(400).json({ error: "Paid invoices are locked" });
        if (isVoid) return res.status(400).json({ error: "Void invoices are locked" });

        financialUpdates.subtotalCents = Math.max(0, Math.round(nextSubtotalCents));
        financialUpdates.taxCents = Math.max(0, Math.round(nextTaxCents));
        financialUpdates.shippingCents = Math.max(0, Math.round(nextShippingCents));
        financialUpdates.totalCents = computedNextTotalCents;
        financialUpdates.subtotal = (financialUpdates.subtotalCents / 100).toFixed(2);
        financialUpdates.tax = (financialUpdates.taxCents / 100).toFixed(2);
        financialUpdates.total = (financialUpdates.totalCents / 100).toFixed(2);
        financialUpdates.balanceDue = String(Math.max(0, Number(financialUpdates.total) - Number(existing.amountPaid)));

        if (existingStatus !== "draft") {
          return res.status(400).json({ error: "Invoice cannot be financially edited in its current status" });
        }

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_financial_edited_after_billing",
            entityType: "invoice",
            entityId: id,
            entityName: String(existing.invoiceNumber),
            description: `Invoice financials updated${isBilledUnpaid ? " (post-billing)" : ""}`,
            oldValues: { subtotalCents: existing.subtotalCents, taxCents: existing.taxCents, shippingCents: existing.shippingCents, totalCents: existing.totalCents } as any,
            newValues: { subtotalCents: financialUpdates.subtotalCents, taxCents: financialUpdates.taxCents, shippingCents: financialUpdates.shippingCents, totalCents: financialUpdates.totalCents } as any,
            createdAt: new Date(),
          } as any);
        } catch {}
      }

      await db.update(invoices).set({ ...updates, ...financialUpdates, updatedAt: new Date() } as any).where(eq(invoices.id, id));

      const refreshed = await getInvoiceWithRelations(id);
      res.json({ success: true, data: refreshed?.invoice ?? null });
    } catch (error: any) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ error: error.message || "Failed to update invoice" });
    }
  });

  // ------------------------------------------------------------
  // Resolve the exact default and saved customer recipients before send.
  // ------------------------------------------------------------
  app.get("/api/invoices/:id/email-recipients", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const result = await resolveInvoiceEmailRecipientsForOperations({
        organizationId,
        invoiceId: req.params.id,
      });
      return res.json({
        success: true,
        data: {
          recipients: result.recipients,
          defaultRecipient: result.defaultRecipient,
        },
      });
    } catch (error: any) {
      return res.status(Number(error.statusCode || error.status || 500)).json({
        success: false,
        error: error.message || "Failed to resolve invoice email recipients",
      });
    }
  });

  // Replays a durably captured provider observation only. It retrieves no
  // provider data and therefore cannot initiate or repeat a charge/refund.
  app.post('/api/payments/stripe/events/:eventId/reconcile', isAuthenticated, tenantContext, ...(requireOrgOwnerAdmin ? [requireOrgOwnerAdmin] : []), async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const eventId = String(req.params.eventId || "").trim();
      const [event] = await db.select({ organizationId: paymentWebhookEvents.organizationId })
        .from(paymentWebhookEvents)
        .where(and(eq(paymentWebhookEvents.provider, "stripe"), eq(paymentWebhookEvents.eventId, eventId)))
        .limit(1);
      if (!event || event.organizationId !== organizationId) return res.status(404).json({ error: "Stripe reconciliation event not found" });
      const result = await retryStripeObservationByEvent(eventId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      const conflict = error?.code === "STRIPE_EVENT_CONFLICT" || error?.code === "STRIPE_EVENT_INVOICE_MISMATCH";
      return res.status(conflict ? 409 : 500).json({ success: false, error: error?.message || "Failed to reconcile Stripe payment", code: error?.code });
    }
  });

  // ------------------------------------------------------------
  // Send invoice via email with PDF attachment
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/send", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;
      const { id } = req.params;
      const { toEmail } = req.body || {};

      console.log(`[Invoice Send] Starting send for invoice ${id}, org ${organizationId}`);
      const result = await sendInvoiceEmailForOperations({
        organizationId,
        invoiceId: id,
        userId,
        userName,
        toEmail,
      });

      console.log(`[Invoice Send] Email sent successfully to ${result.recipientEmail}`);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      console.error("[Invoice Send] FAILED:", {
        error: error.message,
        stack: error.stack,
        code: error.code,
      });

      const errorMessage = error.message || "Failed to send invoice";
      return res.status(Number(error.statusCode || error.status || 500)).json({
        success: false,
        error: errorMessage.includes("Email settings not configured")
          ? "Email is not configured. Please configure email settings in the admin panel."
          : errorMessage,
      });
    }
  });

  app.post("/api/invoices/batch-send", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;
      const invoiceIds: string[] = Array.isArray(req.body?.invoiceIds)
        ? Array.from(new Set(req.body.invoiceIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)))
        : [];

      if (invoiceIds.length === 0) {
        return res.status(400).json({ success: false, error: "Select at least one invoice to send" });
      }

      const results: Array<{
        invoiceId: string;
        success: boolean;
        message: string;
        data?: unknown;
      }> = [];

      for (const invoiceId of invoiceIds) {
        try {
          const data = await sendInvoiceEmailForOperations({
            organizationId,
            invoiceId,
            userId,
            userName,
          });
          results.push({ invoiceId, success: true, message: "Sent", data });
        } catch (error: any) {
          results.push({
            invoiceId,
            success: false,
            message: error?.message || "Failed to send invoice",
          });
        }
      }

      const sent = results.filter((row) => row.success).length;
      const failed = results.length - sent;
      return res.json({
        success: failed === 0,
        data: { sent, failed, results },
        message: `${sent} sent${failed ? `, ${failed} failed` : ""}`,
      });
    } catch (error: any) {
      console.error("[Invoice Batch Send] failed:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to batch send invoices" });
    }
  });

  // ------------------------------------------------------------
  // Mark invoice as sent (read-only semantics; does not change financial status)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/mark-sent", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const { id } = req.params;
      const via = req.body?.via;
      if (via !== "email" && via !== "manual" && via !== "portal") {
        return res.status(400).json({ error: "Invalid via. Expected 'email' | 'manual' | 'portal'" });
      }

      if (!userId) return res.status(401).json({ error: "Missing user" });
      await canonicalInvoiceOperations.markSent({ organizationId, actorUserId: userId, invoiceId: id, via });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error marking invoice sent:", error);
      res.status(500).json({ error: error.message || "Failed to mark invoice sent" });
    }
  });

  // ------------------------------------------------------------
  // Orders: billing-ready override / clear override
  // ------------------------------------------------------------
  app.post("/api/orders/:id/billing-ready-override", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const orderId = req.params.id;
      const note = typeof req.body?.note === "string" ? req.body.note : null;

      const now = new Date();

      await db
        .update(orders)
        .set({ billingStatus: "ready", billingReadyAt: now, billingReadyOverride: true, billingReadyOverrideNote: note, billingReadyOverrideAt: now, billingReadyOverrideByUserId: userId || null, updatedAt: sql`now()` as any } as any)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting billing override:", error);
      res.status(500).json({ error: error.message || "Failed to set override" });
    }
  });

  app.post("/api/orders/:id/clear-billing-ready-override", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const orderId = req.params.id;

      await db
        .update(orders)
        .set({ billingReadyOverride: false, billingReadyOverrideNote: null, billingReadyOverrideAt: null, billingReadyOverrideByUserId: null, updatedAt: sql`now()` as any } as any)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

      await recomputeOrderBillingStatus({ organizationId, orderId });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error clearing billing override:", error);
      res.status(500).json({ error: error.message || "Failed to clear override" });
    }
  });

  // ------------------------------------------------------------
  // Legacy payment endpoints: POST /api/payments, DELETE /api/payments/:id
  // Extracted from server/routes.ts (do NOT re-add there)
  // ------------------------------------------------------------

  // Apply payment
  app.post('/api/payments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const userId = getUserId(req.user);
      const { invoiceId, amount, method, notes } = req.body || {};
      if (!invoiceId || !amount || !method) return res.status(400).json({ error: 'invoiceId, amount, method required' });

      // Ensure invoice belongs to org
      const rel = await getInvoiceWithRelations(invoiceId);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      if ((rel.invoice as any).organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      if (!userId) return res.status(401).json({ error: 'Missing user' });
      const importedPaymentBlockReason = getImportedQuickBooksPaymentBlockReason(rel.invoice as any, rel.payments as any);
      if (importedPaymentBlockReason) return res.status(409).json({ error: importedPaymentBlockReason, code: 'IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED' });
      if (!(canonicalManualPaymentMethodValues as readonly string[]).includes(String(method))) return res.status(400).json({ error: 'Unsupported manual payment method' });
      const amountCents = Math.round(Number(amount) * 100);
      const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();
      if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required', code: 'IDEMPOTENCY_KEY_REQUIRED' });
      const result = await canonicalPaymentOperations.recordManualPayment({ organizationId, actorUserId: userId, invoiceId, amountCents, method, notes, idempotencyKey: `ui:${idempotencyKey}`, source: 'ui' });
      res.json({ success: true, data: result.payment });
    } catch (error: any) {
      console.error('Error applying payment:', error);
      res.status(500).json({ error: error.message || 'Failed to apply payment' });
    }
  });

  // Legacy payment deletion endpoint: retain history by soft-voiding manual payments.
  app.delete('/api/payments/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: 'Missing user' });

      const paymentId = req.params.id;
      const paymentRows = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));
      const payment = paymentRows[0];
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      const result = await voidManualPaymentCanonical({
        organizationId,
        invoiceId: payment.invoiceId,
        paymentId,
        userId,
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      const code = error?.code;
      if (code === 'PAYMENT_VOID_NOT_ALLOWED') return res.status(400).json({ error: error.message, code });
      if (code === 'INVOICE_NOT_FOUND' || code === 'PAYMENT_NOT_FOUND') return res.status(404).json({ error: error.message, code });
      console.error('Error voiding legacy payment deletion:', error);
      res.status(500).json({ error: error.message || 'Failed to void payment' });
    }
  });

  // ---------------------------------------------------------------------------
  // Invoice reminder settings
  // ---------------------------------------------------------------------------
  const reminderSettingsMiddlewares = requireOrgOwnerAdmin
    ? [isAuthenticated, tenantContext, requireOrgOwnerAdmin]
    : [isAuthenticated, tenantContext];

  // GET /api/invoices/reminder-settings
  app.get("/api/invoices/reminder-settings", ...reminderSettingsMiddlewares, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const settings = await getInvoiceReminderSettingsForOrg(organizationId);
      return res.json({ success: true, data: settings ?? null });
    } catch (error) {
      console.error("Error fetching reminder settings:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch reminder settings" });
    }
  });

  // PUT /api/invoices/reminder-settings
  app.put("/api/invoices/reminder-settings", ...reminderSettingsMiddlewares, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const parsed = updateInvoiceReminderSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: "Invalid settings payload", details: parsed.error.flatten() });
      }

      const updated = await upsertInvoiceReminderSettingsForOrg(organizationId, parsed.data);
      return res.json({ success: true, data: updated });
    } catch (error) {
      console.error("Error saving reminder settings:", error);
      return res.status(500).json({ success: false, error: "Failed to save reminder settings" });
    }
  });

  // GET /api/invoices/reminder-preview
  // Read-only. Shows eligibility per open invoice. No emails sent. No mutations.
  app.get("/api/invoices/reminder-preview", ...reminderSettingsMiddlewares, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const preview = await getInvoiceReminderPreviewForOrg(organizationId);
      return res.json({ success: true, data: preview });
    } catch (error) {
      console.error("Error generating reminder preview:", error);
      return res.status(500).json({ success: false, error: "Failed to generate reminder preview" });
    }
  });

  // ---------------------------------------------------------------------------
  // Admin: Manual reminder job trigger (testing / ops use only)
  // ---------------------------------------------------------------------------

  // POST /api/invoices/reminders/run
  // Runs the reminder job once for the current organization.
  // Requires active-org Owner/Admin authority. Returns the job summary.
  // Do not expose a frontend button for this unless a safe admin tools area exists.
  const adminMiddlewares = requireOrgOwnerAdmin
    ? [isAuthenticated, tenantContext, requireOrgOwnerAdmin]
    : [isAuthenticated, tenantContext];

  app.post("/api/invoices/reminders/run", ...adminMiddlewares, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      console.log(`[InvoiceReminders] Manual run triggered by user ${getUserId(req.user)} for org ${organizationId}`);

      const summary = await runInvoiceReminderJob(new Date(), undefined, organizationId);
      return res.json({ success: true, data: summary });
    } catch (error: any) {
      console.error("Error running reminder job:", error);
      return res.status(500).json({ success: false, error: "Reminder job failed", details: error?.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/invoices/:id/send-reminder
  // Manually send a reminder for a single invoice.
  // Same auth as invoice send. Returns success, lastReminderSentAt, reminderCount.
  // ---------------------------------------------------------------------------
  app.post("/api/invoices/:id/send-reminder", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const invoiceId = req.params.id;
      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || 'Unknown';

      if (!userId) return res.status(401).json({ success: false, error: "Missing user context" });

      console.log(`[SendReminder] User ${userId} sending manual reminder for invoice ${invoiceId} org ${organizationId}`);

      const result = await sendManualInvoiceReminder({
        invoiceId,
        organizationId,
        userId,
        userName,
      });

      if (!result.success) {
        // Return 409 for idempotency blocks or business-rule blocks; 400 for other failures
        const status = result.message?.includes('recently sent') ? 409 : 400;
        return res.status(status).json({ success: false, error: result.message });
      }

      return res.json({
        success: true,
        lastReminderSentAt: result.lastReminderSentAt,
        reminderCount: result.reminderCount,
      });
    } catch (error: any) {
      console.error("[SendReminder] Unexpected error:", error);
      return res.status(500).json({ success: false, error: "Failed to send reminder" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/invoices/:id/reminder-history
  // Returns all reminder log entries for an invoice (sent + failed), newest first.
  // ---------------------------------------------------------------------------
  app.get("/api/invoices/:id/reminder-history", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const invoiceId = req.params.id;

      // Verify the invoice belongs to this org
      const [inv] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
        .limit(1);

      if (!inv) return res.status(404).json({ success: false, error: "Invoice not found" });

      const logs = await db
        .select({
          id: invoiceReminderLogs.id,
          sentAt: invoiceReminderLogs.sentAt,
          recipientEmail: invoiceReminderLogs.recipientEmail,
          status: invoiceReminderLogs.status,
          reminderNumber: invoiceReminderLogs.reminderNumber,
          messageId: invoiceReminderLogs.messageId,
          failureReason: invoiceReminderLogs.failureReason,
        })
        .from(invoiceReminderLogs)
        .where(
          and(
            eq(invoiceReminderLogs.invoiceId, invoiceId),
            eq(invoiceReminderLogs.organizationId, organizationId),
          ),
        )
        .orderBy(desc(invoiceReminderLogs.sentAt))
        .limit(50);

      return res.json({ success: true, data: logs });
    } catch (error: any) {
      console.error("[ReminderHistory] Error:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch reminder history" });
    }
  });
}
