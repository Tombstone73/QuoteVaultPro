import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { invoices, orders, payments } from "../../../shared/schema";
import { normalizeInvoiceAccountingDisplay } from "../../../shared/invoiceAccountingDisplay";
import { resolveHostedPaymentProvider, type ConfiguredPaymentProvider, type HostedPaymentProvider } from "../../../shared/paymentProviderResolution";
import {
  getInvoiceFinancialPaymentEligibility,
  type AvailablePaymentMethod,
  type PaymentInvoiceCandidate,
  type PaymentProviderSummary,
  type PaymentResolution,
} from "../../../shared/paymentOrchestration";
import { getPaymentSettings } from "./paymentProvider.service";
import { resolveStripeReadiness } from "../stripeReadiness.service";

function asCents(value: unknown): number {
  const numeric = Math.round(Number(value || 0));
  return Number.isFinite(numeric) ? numeric : 0;
}

function isSucceededPaymentStatus(value: unknown): boolean {
  const status = String(value || "succeeded").trim().toLowerCase();
  return status === "succeeded" || status === "captured";
}

function buildDisplayNumber(invoice: Record<string, any>): string | null {
  const display = String(invoice.displayNumber || "").trim();
  if (display) return display;
  if (invoice.numberCore != null) return String(invoice.numberCore);
  if (invoice.invoiceNumber != null) return String(invoice.invoiceNumber);
  return null;
}

function getImportedQuickBooksBlockReason(invoice: Record<string, any>, remainingBalanceCents: number): string | null {
  if (String(invoice.importSource || "").trim().toLowerCase() !== "quickbooks") return null;
  if (Boolean(invoice.isHistorical)) return "Historical imported QuickBooks invoices cannot accept payments.";
  if (!String(invoice.qbInvoiceId || "").trim()) return "Imported QuickBooks invoice is missing its QuickBooks Invoice ID.";
  if (remainingBalanceCents <= 0) return "Invoice is already paid.";
  return null;
}

export function getInvoicePaymentEligibility(input: {
  invoice: Record<string, any>;
  payments: Array<Record<string, any>>;
}): {
  payable: boolean;
  blockedReason: string | null;
  amountPaidCents: number;
  remainingBalanceCents: number;
} {
  const normalized = normalizeInvoiceAccountingDisplay({
    ...input.invoice,
    payments: input.payments.map((payment) => ({
      id: payment.id,
      status: payment.status,
      amountCents: asCents(payment.amountCents),
      syncStatus: payment.syncStatus,
      externalAccountingId: payment.externalAccountingId,
      qbReconciledAt: payment.qbReconciledAt,
    })),
  });

  const status = String(input.invoice.status || "").trim().toLowerCase();
  const totalCents = asCents((input.invoice as any).totalCents ?? normalized.displayTotalCents);
  const fallbackPaidCents = input.payments.reduce((sum, payment) => {
    if (!isSucceededPaymentStatus(payment.status)) return sum;
    return sum + asCents(payment.amountCents);
  }, 0);
  const amountPaidCents = Math.max(0, asCents(normalized.displayPaidCents ?? fallbackPaidCents));
  const remainingBalanceCents = Math.max(0, asCents(normalized.displayRemainingCents ?? (totalCents - amountPaidCents)));
  const importedBlock = getImportedQuickBooksBlockReason(input.invoice, remainingBalanceCents);
  if (importedBlock) return { payable: false, blockedReason: importedBlock, amountPaidCents, remainingBalanceCents };
  const financialEligibility = getInvoiceFinancialPaymentEligibility({ invoiceStatus: status, remainingCents: remainingBalanceCents });
  return { ...financialEligibility, amountPaidCents, remainingBalanceCents };
}

function toInvoiceCandidate(invoice: Record<string, any>, paymentRows: Array<Record<string, any>>): PaymentInvoiceCandidate {
  const eligibility = getInvoicePaymentEligibility({ invoice, payments: paymentRows });
  return {
    id: String(invoice.id),
    invoiceNumber: invoice.invoiceNumber == null ? null : Number(invoice.invoiceNumber),
    displayNumber: buildDisplayNumber(invoice),
    numberCore: invoice.numberCore == null ? null : Number(invoice.numberCore),
    status: String(invoice.status || "draft"),
    totalCents: Math.max(0, asCents(invoice.totalCents)),
    amountPaidCents: eligibility.amountPaidCents,
    remainingBalanceCents: eligibility.remainingBalanceCents,
    payable: eligibility.payable,
    blockedReason: eligibility.blockedReason,
  };
}

async function getProviderSummary(organizationId: string): Promise<PaymentProviderSummary> {
  const [settings, stripeReadiness] = await Promise.all([
    getPaymentSettings(organizationId),
    resolveStripeReadiness(organizationId),
  ]);

  const stripeConnected = settings.stripeEnabled && stripeReadiness.readyForPayments;
  const availableHostedProviders = [
    stripeConnected ? "stripe" : null,
    settings.epsReady ? "eps" : null,
  ].filter((provider): provider is HostedPaymentProvider => provider === "stripe" || provider === "eps");

  const hostedResolution = resolveHostedPaymentProvider({
    configuredDefaultProvider: settings.provider,
    availableProviders: availableHostedProviders,
  });

  return {
    configuredProvider: settings.provider as ConfiguredPaymentProvider,
    hostedProvider: hostedResolution.provider,
    hostedResolution,
    epsReady: settings.epsReady,
    stripeEnabled: settings.stripeEnabled,
    stripeConnected,
  };
}

function availablePaymentMethodsFor(input: { provider: PaymentProviderSummary; hasPayableInvoice: boolean }): AvailablePaymentMethod[] {
  if (!input.hasPayableInvoice) return [];
  const methods: AvailablePaymentMethod[] = ["manual"];
  if (input.provider.hostedProvider) methods.unshift("hosted_card");
  return methods;
}

async function getOrderInvoiceCandidates(organizationId: string, orderId: string): Promise<PaymentInvoiceCandidate[]> {
  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, orderId)))
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));

  const invoiceIds = invoiceRows.map((invoice) => String(invoice.id));
  const paymentRows = invoiceIds.length
    ? await db
        .select()
        .from(payments)
        .where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, invoiceIds)))
    : [];

  const paymentsByInvoiceId = new Map<string, Array<Record<string, any>>>();
  for (const payment of paymentRows as any[]) {
    const invoiceId = String(payment.invoiceId || "");
    const bucket = paymentsByInvoiceId.get(invoiceId) ?? [];
    bucket.push(payment);
    paymentsByInvoiceId.set(invoiceId, bucket);
  }

  return invoiceRows.map((invoice) => toInvoiceCandidate(invoice as any, paymentsByInvoiceId.get(String(invoice.id)) ?? []));
}

export async function resolveOrderPayment(input: {
  organizationId: string;
  orderId: string;
}): Promise<PaymentResolution | null> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId)))
    .limit(1);
  if (!order) return null;

  const [provider, invoiceCandidates] = await Promise.all([
    getProviderSummary(input.organizationId),
    getOrderInvoiceCandidates(input.organizationId, input.orderId),
  ]);

  return buildOrderPaymentResolutionFromCandidates({
    orderId: input.orderId,
    provider,
    invoiceCandidates,
  });
}

export function buildOrderPaymentResolutionFromCandidates(input: {
  orderId: string;
  provider: PaymentProviderSummary;
  invoiceCandidates: PaymentInvoiceCandidate[];
}): PaymentResolution {
  const { orderId, provider, invoiceCandidates } = input;
  const payableCandidates = invoiceCandidates.filter((invoice) => invoice.payable);
  const paidCandidates = invoiceCandidates.filter((invoice) => invoice.remainingBalanceCents <= 0 || invoice.status.toLowerCase() === "paid");

  if (invoiceCandidates.length === 0) {
    return {
      entityType: "order",
      orderId,
      requestedInvoiceId: null,
      resolutionStatus: "NO_INVOICE",
      payable: false,
      blockedReason: "This order must be invoiced before payment can be collected.",
      invoiceCandidates,
      selectedInvoice: null,
      amountDueCents: 0,
      provider,
      availablePaymentMethods: [],
      recommendedAction: "GENERATE_INVOICE",
      redirectTarget: null,
    };
  }

  if (payableCandidates.length === 1) {
    const selectedInvoice = payableCandidates[0];
    return {
      entityType: "order",
      orderId,
      requestedInvoiceId: selectedInvoice.id,
      resolutionStatus: "SINGLE_PAYABLE_INVOICE",
      payable: true,
      blockedReason: null,
      invoiceCandidates,
      selectedInvoice,
      amountDueCents: selectedInvoice.remainingBalanceCents,
      provider,
      availablePaymentMethods: availablePaymentMethodsFor({ provider, hasPayableInvoice: true }),
      recommendedAction: "TAKE_PAYMENT",
      redirectTarget: `/invoices/${selectedInvoice.id}?takePayment=1`,
    };
  }

  if (payableCandidates.length > 1) {
    return {
      entityType: "order",
      orderId,
      requestedInvoiceId: null,
      resolutionStatus: "MULTIPLE_PAYABLE_INVOICES",
      payable: true,
      blockedReason: null,
      invoiceCandidates,
      selectedInvoice: null,
      amountDueCents: payableCandidates.reduce((sum, invoice) => sum + invoice.remainingBalanceCents, 0),
      provider,
      availablePaymentMethods: availablePaymentMethodsFor({ provider, hasPayableInvoice: true }),
      recommendedAction: "SELECT_INVOICE",
      redirectTarget: null,
    };
  }

  if (invoiceCandidates.length === 1 && paidCandidates.length === 1) {
    const selectedInvoice = invoiceCandidates[0];
    return {
      entityType: "order",
      orderId,
      requestedInvoiceId: selectedInvoice.id,
      resolutionStatus: "ALREADY_PAID",
      payable: false,
      blockedReason: "Invoice is already paid.",
      invoiceCandidates,
      selectedInvoice,
      amountDueCents: 0,
      provider,
      availablePaymentMethods: [],
      recommendedAction: "VIEW_PAID_INVOICE",
      redirectTarget: `/invoices/${selectedInvoice.id}`,
    };
  }

  const blockedReason =
    invoiceCandidates.length === 1
      ? invoiceCandidates[0].blockedReason || "This invoice cannot accept payment."
      : "This order has invoices, but none can currently accept payment.";

  return {
    entityType: "order",
    orderId,
    requestedInvoiceId: invoiceCandidates.length === 1 ? invoiceCandidates[0].id : null,
    resolutionStatus: "BLOCKED",
    payable: false,
    blockedReason,
    invoiceCandidates,
    selectedInvoice: invoiceCandidates.length === 1 ? invoiceCandidates[0] : null,
    amountDueCents: 0,
    provider,
    availablePaymentMethods: [],
    recommendedAction: "BLOCKED",
    redirectTarget: invoiceCandidates.length === 1 ? `/invoices/${invoiceCandidates[0].id}` : null,
  };
}
