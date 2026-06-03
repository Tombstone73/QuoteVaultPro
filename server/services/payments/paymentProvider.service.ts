import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  auditLogs,
  customers,
  invoices,
  organizationPaymentSettings,
  payments,
  type OrganizationPaymentSettings,
} from "../../../shared/schema";
import { normalizeInvoiceAccountingDisplay } from "../../../shared/invoiceAccountingDisplay";
import { refreshInvoiceStatus } from "../../invoicesService";
import {
  buildHostedPtkRequest,
  EpsGatewayClient,
  formatCentsAsEpsAmount,
  normalizeEpsResponse,
  type EpsMode,
  type EpsNormalizedResponse,
} from "./epsGatewayClient";

type Actor = {
  userId?: string | null;
  userName?: string | null;
};

type ProviderResult = {
  payment: Record<string, unknown> | null;
  response: EpsNormalizedResponse;
  hostedPaymentUrl?: string | null;
  reused?: boolean;
};

export type SafePaymentSettings = {
  provider: "none" | "eps";
  epsEnabled: boolean;
  epsAccountNumber: string | null;
  epsApiKeyConfigured: boolean;
  epsCnpBaseUrl: string;
  epsCardPresentBaseUrl: string;
  epsAchBaseUrl: string;
  epsGiftBaseUrl: string;
  epsDeviceSerialNumber: string | null;
  epsSupportedModes: EpsMode[];
  epsReady: boolean;
  missing: string[];
};

export class PaymentProviderError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, code = "PAYMENT_PROVIDER_ERROR", statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function getUserName(actor?: Actor): string | null {
  return asString(actor?.userName) || null;
}

function getDefaultSafeSettings(): SafePaymentSettings {
  return {
    provider: "none",
    epsEnabled: false,
    epsAccountNumber: null,
    epsApiKeyConfigured: false,
    epsCnpBaseUrl: "https://postransactions.com/cnp",
    epsCardPresentBaseUrl: "https://postransactions.com/connet",
    epsAchBaseUrl: "https://postransactions.com/ach",
    epsGiftBaseUrl: "https://postransactions.com/gift",
    epsDeviceSerialNumber: null,
    epsSupportedModes: ["hosted_cnp"],
    epsReady: false,
    missing: ["provider"],
  };
}

export function toSafePaymentSettings(row: OrganizationPaymentSettings | null | undefined): SafePaymentSettings {
  if (!row) return getDefaultSafeSettings();
  const supportedModes: EpsMode[] = Array.isArray((row as any).epsSupportedModes)
    ? ((row as any).epsSupportedModes as string[]).filter((mode): mode is EpsMode =>
        ["hosted_cnp", "token_cnp", "card_present", "ach", "gift_card"].includes(mode),
      )
    : ["hosted_cnp"];

  const provider = row.provider === "eps" ? "eps" : "none";
  const missing: string[] = [];
  if (provider !== "eps") missing.push("provider");
  if (!row.epsEnabled) missing.push("epsEnabled");
  if (!asString(row.epsAccountNumber)) missing.push("epsAccountNumber");
  if (!asString(row.epsApiKey)) missing.push("epsApiKey");

  return {
    provider,
    epsEnabled: Boolean(row.epsEnabled),
    epsAccountNumber: asString(row.epsAccountNumber) || null,
    epsApiKeyConfigured: Boolean(asString(row.epsApiKey)),
    epsCnpBaseUrl: asString(row.epsCnpBaseUrl) || "https://postransactions.com/cnp",
    epsCardPresentBaseUrl: asString(row.epsCardPresentBaseUrl) || "https://postransactions.com/connet",
    epsAchBaseUrl: asString(row.epsAchBaseUrl) || "https://postransactions.com/ach",
    epsGiftBaseUrl: asString(row.epsGiftBaseUrl) || "https://postransactions.com/gift",
    epsDeviceSerialNumber: asString(row.epsDeviceSerialNumber) || null,
    epsSupportedModes: supportedModes,
    epsReady: missing.length === 0,
    missing,
  };
}

function assertNoApiKeyLeak(settings: SafePaymentSettings): SafePaymentSettings {
  if ("epsApiKey" in (settings as any)) {
    throw new Error("Unsafe payment settings DTO includes epsApiKey");
  }
  return settings;
}

async function getSettingsRow(organizationId: string): Promise<OrganizationPaymentSettings | null> {
  const [row] = await db
    .select()
    .from(organizationPaymentSettings)
    .where(eq(organizationPaymentSettings.organizationId, organizationId))
    .limit(1);
  return (row as OrganizationPaymentSettings | undefined) ?? null;
}

async function requireEpsSettings(organizationId: string, mode: EpsMode): Promise<OrganizationPaymentSettings> {
  const row = await getSettingsRow(organizationId);
  const safe = toSafePaymentSettings(row);
  if (!row || safe.provider !== "eps" || !safe.epsEnabled) {
    throw new PaymentProviderError("EPS is not enabled for this organization.", "EPS_NOT_ENABLED", 409);
  }
  if (!safe.epsSupportedModes.includes(mode)) {
    throw new PaymentProviderError(`EPS mode ${mode} is not enabled for this organization.`, "EPS_MODE_DISABLED", 409);
  }
  if (!safe.epsAccountNumber || !safe.epsApiKeyConfigured) {
    throw new PaymentProviderError("EPS account number and API key are required before taking payments.", "EPS_SETTINGS_INCOMPLETE", 409);
  }
  if (mode === "card_present" && !safe.epsDeviceSerialNumber) {
    throw new PaymentProviderError("EPS card-present device serial number is required.", "EPS_DEVICE_MISSING", 409);
  }
  return row;
}

function createEpsClient(settings: OrganizationPaymentSettings): EpsGatewayClient {
  return new EpsGatewayClient({
    apiKey: asString(settings.epsApiKey),
    accountNumber: asString(settings.epsAccountNumber),
    cnpBaseUrl: asString(settings.epsCnpBaseUrl),
    cardPresentBaseUrl: asString(settings.epsCardPresentBaseUrl),
    achBaseUrl: asString(settings.epsAchBaseUrl),
    giftBaseUrl: asString(settings.epsGiftBaseUrl),
  });
}

async function getInvoiceContext(organizationId: string, invoiceId: string) {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
    .limit(1);
  if (!inv) throw new PaymentProviderError("Invoice not found", "INVOICE_NOT_FOUND", 404);

  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.invoiceId, invoiceId), eq(payments.organizationId, organizationId)))
    .orderBy(desc(payments.createdAt));

  const status = asString((inv as any).status).toLowerCase();
  if (status === "void") throw new PaymentProviderError("Cannot pay a void invoice", "INVOICE_VOID", 400);
  if (Boolean((inv as any).isHistorical)) {
    throw new PaymentProviderError("Historical imported invoices cannot accept EPS payments.", "IMPORTED_INVOICE_LOCKED", 409);
  }

  const normalized = normalizeInvoiceAccountingDisplay({
    ...(inv as any),
    payments: rows.map((payment: any) => ({
      id: payment.id,
      status: payment.status,
      amountCents: Number(payment.amountCents || 0),
      syncStatus: payment.syncStatus,
      externalAccountingId: payment.externalAccountingId,
      qbReconciledAt: payment.qbReconciledAt,
    })),
  });

  return {
    invoice: inv as any,
    paymentRows: rows as any[],
    remainingCents: Math.max(0, Math.round(Number(normalized.displayRemainingCents || 0))),
  };
}

function assertAmountCanApply(amountCents: number, remainingCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new PaymentProviderError("amountCents must be a positive integer.", "INVALID_AMOUNT", 400);
  }
  if (amountCents > remainingCents) {
    throw new PaymentProviderError("Overpayment not allowed.", "OVERPAYMENT_NOT_ALLOWED", 400);
  }
}

async function findExistingEpsIdempotency(organizationId: string, idempotencyKey: string) {
  const [existing] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.provider, "eps"),
        eq(payments.providerIdempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return existing as any | undefined;
}

export function validateEpsIdempotencyKey(input: unknown): string {
  const key = asString(input);
  if (key.length < 8 || key.length > 160) {
    throw new PaymentProviderError("idempotencyKey is required and must be 8-160 characters.", "IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  return key;
}

function existingPaymentResult(payment: any): ProviderResult {
  return {
    payment,
    reused: true,
    hostedPaymentUrl: payment?.epsHostedPaymentUrl ?? null,
    response: normalizeEpsResponse({
      TransactionResult: String(payment?.status || "").toLowerCase() === "succeeded",
      ResponseMsg: payment?.epsResponseMessage || "Existing EPS payment attempt reused",
      ResponseCode: payment?.epsResponseCode || null,
      TransactionID: payment?.providerTransactionId || null,
      PTK: payment?.epsPtk || null,
      ApprovedAmount: payment?.epsApprovedAmountCents == null ? undefined : formatCentsAsEpsAmount(Number(payment.epsApprovedAmountCents)),
      AuthCode: payment?.epsAuthCode || null,
      CardType: payment?.epsCardType || null,
      AccountNum: payment?.epsTokenLast4 || null,
      Method: payment?.epsMethod || null,
    }),
  };
}

async function insertEpsPayment(input: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  method: "credit_card" | "ach" | "other";
  status: "pending" | "succeeded" | "failed" | "refunded" | "voided" | "captured";
  mode: EpsMode;
  epsMethod: string;
  response: EpsNormalizedResponse;
  idempotencyKey?: string | null;
  hostedPaymentUrl?: string | null;
  actor?: Actor;
  notes?: string | null;
}) {
  const now = new Date();
  const [payment] = await db
    .insert(payments)
    .values({
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      provider: "eps",
      status: input.status,
      amount: formatCentsAsEpsAmount(input.amountCents),
      amountCents: input.amountCents,
      currency: input.currency,
      providerTransactionId: input.response.providerTransactionId,
      providerIdempotencyKey: input.idempotencyKey || null,
      epsPtk: input.response.ptk,
      epsHostedPaymentUrl: input.hostedPaymentUrl || null,
      epsMode: input.mode,
      epsMethod: input.epsMethod,
      epsAuthCode: input.response.authCode,
      epsResponseCode: input.response.responseCode,
      epsResponseMessage: input.response.responseMessage,
      epsApprovedAmountCents: input.response.approvedAmountCents,
      epsTokenLast4: input.response.tokenLast4,
      epsCardType: input.response.cardType,
      metadata: {
        eps: {
          mode: input.mode,
          method: input.epsMethod,
          rawSafe: input.response.rawSafe,
        },
      } as any,
      method: input.method,
      notes: input.notes || null,
      note: input.notes || null,
      appliedAt: now,
      paidAt: input.status === "succeeded" || input.status === "captured" ? now : null,
      succeededAt: input.status === "succeeded" || input.status === "captured" ? now : null,
      failedAt: input.status === "failed" ? now : null,
      canceledAt: input.status === "voided" ? now : null,
      refundedAt: input.status === "refunded" ? now : null,
      createdByUserId: input.actor?.userId || null,
      syncStatus: "pending",
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();
  return payment as any;
}

async function audit(input: {
  organizationId: string;
  actor?: Actor;
  actionType: string;
  entityId: string;
  entityName?: string | null;
  description: string;
  values?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actor?.userId || null,
      userName: getUserName(input.actor),
      actionType: input.actionType,
      entityType: "invoice",
      entityId: input.entityId,
      entityName: input.entityName || input.entityId,
      description: input.description,
      newValues: input.values || null,
      createdAt: new Date(),
    } as any);
  } catch {
    // Audit failures should not hide payment processor results.
  }
}

export async function getPaymentSettings(organizationId: string): Promise<SafePaymentSettings> {
  return assertNoApiKeyLeak(toSafePaymentSettings(await getSettingsRow(organizationId)));
}

export async function updatePaymentSettings(
  organizationId: string,
  input: Partial<{
    provider: "none" | "eps";
    epsEnabled: boolean;
    epsAccountNumber: string | null;
    epsApiKey: string | null;
    epsCnpBaseUrl: string;
    epsCardPresentBaseUrl: string;
    epsAchBaseUrl: string;
    epsGiftBaseUrl: string;
    epsDeviceSerialNumber: string | null;
    epsSupportedModes: EpsMode[];
  }>,
): Promise<SafePaymentSettings> {
  const existing = await getSettingsRow(organizationId);
  const now = new Date();
  const nextApiKey =
    Object.prototype.hasOwnProperty.call(input, "epsApiKey")
      ? asString(input.epsApiKey) || null
      : existing?.epsApiKey ?? null;

  const values = {
    organizationId,
    provider: input.provider ?? existing?.provider ?? "none",
    epsEnabled: input.epsEnabled ?? existing?.epsEnabled ?? false,
    epsAccountNumber: Object.prototype.hasOwnProperty.call(input, "epsAccountNumber")
      ? asString(input.epsAccountNumber) || null
      : existing?.epsAccountNumber ?? null,
    epsApiKey: nextApiKey,
    epsCnpBaseUrl: asString(input.epsCnpBaseUrl) || existing?.epsCnpBaseUrl || "https://postransactions.com/cnp",
    epsCardPresentBaseUrl: asString(input.epsCardPresentBaseUrl) || existing?.epsCardPresentBaseUrl || "https://postransactions.com/connet",
    epsAchBaseUrl: asString(input.epsAchBaseUrl) || existing?.epsAchBaseUrl || "https://postransactions.com/ach",
    epsGiftBaseUrl: asString(input.epsGiftBaseUrl) || existing?.epsGiftBaseUrl || "https://postransactions.com/gift",
    epsDeviceSerialNumber: Object.prototype.hasOwnProperty.call(input, "epsDeviceSerialNumber")
      ? asString(input.epsDeviceSerialNumber) || null
      : existing?.epsDeviceSerialNumber ?? null,
    epsSupportedModes: input.epsSupportedModes ?? ((existing?.epsSupportedModes as EpsMode[] | undefined) || ["hosted_cnp"]),
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  const [row] = await db
    .insert(organizationPaymentSettings)
    .values(values as any)
    .onConflictDoUpdate({
      target: [organizationPaymentSettings.organizationId],
      set: {
        provider: values.provider,
        epsEnabled: values.epsEnabled,
        epsAccountNumber: values.epsAccountNumber,
        epsApiKey: values.epsApiKey,
        epsCnpBaseUrl: values.epsCnpBaseUrl,
        epsCardPresentBaseUrl: values.epsCardPresentBaseUrl,
        epsAchBaseUrl: values.epsAchBaseUrl,
        epsGiftBaseUrl: values.epsGiftBaseUrl,
        epsDeviceSerialNumber: values.epsDeviceSerialNumber,
        epsSupportedModes: values.epsSupportedModes as any,
        updatedAt: now,
      } as any,
    })
    .returning();

  return assertNoApiKeyLeak(toSafePaymentSettings(row as OrganizationPaymentSettings));
}

export async function createHostedSession(input: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  actor?: Actor;
  idempotencyKey?: string | null;
}): Promise<ProviderResult> {
  const settings = await requireEpsSettings(input.organizationId, "hosted_cnp");
  const { invoice, remainingCents } = await getInvoiceContext(input.organizationId, input.invoiceId);
  assertAmountCanApply(input.amountCents, remainingCents);

  const [existingPending] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, input.organizationId),
        eq(payments.invoiceId, input.invoiceId),
        eq(payments.provider, "eps"),
        eq(payments.status, "pending"),
        eq(payments.epsMode, "hosted_cnp"),
        eq(payments.amountCents, input.amountCents),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (existingPending?.epsHostedPaymentUrl && existingPending?.epsPtk) {
    return existingPaymentResult(existingPending as any);
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, invoice.customerId), eq(customers.organizationId, input.organizationId)))
    .limit(1);

  const client = createEpsClient(settings);
  const payload = buildHostedPtkRequest({
    accountNumber: asString(settings.epsAccountNumber),
    amountCents: input.amountCents,
    ticketId: asString(invoice.displayNumber) || String(invoice.invoiceNumber || invoice.id),
    userId: input.actor?.userName || input.actor?.userId || "TitanOS",
    firstName: (customer as any)?.contactFirstName || (customer as any)?.firstName || "",
    lastName: (customer as any)?.contactLastName || (customer as any)?.lastName || "",
    email: (customer as any)?.email || null,
    address: (customer as any)?.billingAddress || (customer as any)?.address || null,
    zip: (customer as any)?.billingZip || (customer as any)?.zipCode || null,
  });
  const response = await client.getHostedPtk(payload);
  if (!response.ptk || !response.pending) {
    throw new PaymentProviderError(response.responseMessage || "EPS did not return a hosted payment token.", "EPS_PTK_FAILED", 502);
  }

  const hostedPaymentUrl = client.buildHostedPaymentUrl(response.ptk);
  const payment = await insertEpsPayment({
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
    currency: asString(invoice.currency) || "USD",
    method: "credit_card",
    status: "pending",
    mode: "hosted_cnp",
    epsMethod: "creditsale",
    response,
    idempotencyKey: input.idempotencyKey || null,
    hostedPaymentUrl,
    actor: input.actor,
    notes: "EPS hosted payment session pending confirmation",
  });

  await audit({
    organizationId: input.organizationId,
    actor: input.actor,
    actionType: "eps_hosted_session_created",
    entityId: input.invoiceId,
    entityName: String(invoice.invoiceNumber),
    description: "EPS hosted payment session created",
    values: { paymentId: payment.id, amountCents: input.amountCents, hasPtk: true },
  });

  return { payment, response, hostedPaymentUrl };
}

export async function createTokenSale(input: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  token: string;
  expirationDate: string;
  idempotencyKey: string;
  actor?: Actor;
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  zip?: string | null;
  email?: string | null;
  paySource?: string | null;
}): Promise<ProviderResult> {
  const idempotencyKey = validateEpsIdempotencyKey(input.idempotencyKey);
  const existing = await findExistingEpsIdempotency(input.organizationId, idempotencyKey);
  if (existing) return existingPaymentResult(existing);

  const settings = await requireEpsSettings(input.organizationId, "token_cnp");
  const { invoice, remainingCents } = await getInvoiceContext(input.organizationId, input.invoiceId);
  assertAmountCanApply(input.amountCents, remainingCents);

  const client = createEpsClient(settings);
  const response = await client.tokenCnpRequest({
    method: "creditsale",
    account: asString(settings.epsAccountNumber),
    paysource: asString(input.paySource) || "PHONE",
    amount: formatCentsAsEpsAmount(input.amountCents),
    firstname: input.firstName || "",
    lastname: input.lastName || "",
    ticketid: asString(invoice.displayNumber) || String(invoice.invoiceNumber || invoice.id),
    userid: input.actor?.userName || input.actor?.userId || "TitanOS",
    token: input.token,
    json: "no",
    ...(input.address ? { address: input.address } : {}),
    ...(input.zip ? { zip: input.zip } : {}),
    expirationdate: input.expirationDate,
    ...(input.email ? { notifyemail1: input.email } : {}),
  });

  const payment = await insertEpsPayment({
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
    currency: asString(invoice.currency) || "USD",
    method: "credit_card",
    status: response.approved ? "succeeded" : "failed",
    mode: "token_cnp",
    epsMethod: "creditsale",
    response,
    idempotencyKey,
    actor: input.actor,
  });
  if (response.approved) await refreshInvoiceStatus(input.invoiceId);
  await audit({
    organizationId: input.organizationId,
    actor: input.actor,
    actionType: response.approved ? "eps_token_sale_approved" : "eps_token_sale_failed",
    entityId: input.invoiceId,
    entityName: String(invoice.invoiceNumber),
    description: response.approved ? "EPS token sale approved" : "EPS token sale failed",
    values: { paymentId: payment.id, amountCents: input.amountCents, responseCode: response.responseCode },
  });
  return { payment, response };
}

export async function createCardPresentSale(input: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  idempotencyKey: string;
  actor?: Actor;
}): Promise<ProviderResult> {
  const idempotencyKey = validateEpsIdempotencyKey(input.idempotencyKey);
  const existing = await findExistingEpsIdempotency(input.organizationId, idempotencyKey);
  if (existing) return existingPaymentResult(existing);

  const settings = await requireEpsSettings(input.organizationId, "card_present");
  const { invoice, remainingCents } = await getInvoiceContext(input.organizationId, input.invoiceId);
  assertAmountCanApply(input.amountCents, remainingCents);

  const response = await createEpsClient(settings).cardPresentTransact({
    method: "creditsale",
    amount: formatCentsAsEpsAmount(input.amountCents),
    account: asString(settings.epsAccountNumber),
    sn: asString(settings.epsDeviceSerialNumber),
  });
  const payment = await insertEpsPayment({
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
    currency: asString(invoice.currency) || "USD",
    method: "credit_card",
    status: response.approved ? "succeeded" : "failed",
    mode: "card_present",
    epsMethod: "creditsale",
    response,
    idempotencyKey,
    actor: input.actor,
  });
  if (response.approved) await refreshInvoiceStatus(input.invoiceId);
  await audit({
    organizationId: input.organizationId,
    actor: input.actor,
    actionType: response.approved ? "eps_card_present_sale_approved" : "eps_card_present_sale_failed",
    entityId: input.invoiceId,
    entityName: String(invoice.invoiceNumber),
    description: response.approved ? "EPS card-present sale approved" : "EPS card-present sale failed",
    values: { paymentId: payment.id, amountCents: input.amountCents, responseCode: response.responseCode },
  });
  return { payment, response };
}

export async function createAchSale(input: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  idempotencyKey: string;
  actor?: Actor;
  checkAccount: string;
  checkRouting: string;
  checkType: string;
  paySource: "CCD" | "PPD" | "WEB";
  firstName?: string | null;
  lastName?: string | null;
  business?: string | null;
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
}): Promise<ProviderResult> {
  const idempotencyKey = validateEpsIdempotencyKey(input.idempotencyKey);
  const existing = await findExistingEpsIdempotency(input.organizationId, idempotencyKey);
  if (existing) return existingPaymentResult(existing);

  const settings = await requireEpsSettings(input.organizationId, "ach");
  const { invoice, remainingCents } = await getInvoiceContext(input.organizationId, input.invoiceId);
  assertAmountCanApply(input.amountCents, remainingCents);

  const response = await createEpsClient(settings).achProcess({
    method: "sale",
    account: asString(settings.epsAccountNumber),
    checkaccount: input.checkAccount,
    checkrouting: input.checkRouting,
    checktype: input.checkType || "Checking",
    amount: formatCentsAsEpsAmount(input.amountCents),
    ticketid: asString(invoice.displayNumber) || String(invoice.invoiceNumber || invoice.id),
    paysource: input.paySource,
    firstname: input.firstName || "",
    lastname: input.lastName || "",
    ...(input.address ? { address: input.address } : {}),
    ...(input.address2 ? { address2: input.address2 } : {}),
    ...(input.city ? { city: input.city } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.zip ? { zip: input.zip } : {}),
    userid: input.actor?.userName || input.actor?.userId || "TitanOS",
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.business ? { business: input.business } : {}),
  });
  const payment = await insertEpsPayment({
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
    currency: asString(invoice.currency) || "USD",
    method: "ach",
    status: response.approved ? "pending" : "failed",
    mode: "ach",
    epsMethod: "sale",
    response,
    idempotencyKey,
    actor: input.actor,
    notes: response.approved ? "EPS ACH approval pending bank clearing" : null,
  });
  await audit({
    organizationId: input.organizationId,
    actor: input.actor,
    actionType: response.approved ? "eps_ach_sale_pending" : "eps_ach_sale_failed",
    entityId: input.invoiceId,
    entityName: String(invoice.invoiceNumber),
    description: response.approved ? "EPS ACH sale submitted pending clearing" : "EPS ACH sale failed",
    values: { paymentId: payment.id, amountCents: input.amountCents, responseCode: response.responseCode },
  });
  return { payment, response };
}

export async function createGiftCardSale(input: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  giftCardToken: string;
  idempotencyKey: string;
  actor?: Actor;
  owner?: string | null;
  location?: string | null;
}): Promise<ProviderResult> {
  const idempotencyKey = validateEpsIdempotencyKey(input.idempotencyKey);
  const existing = await findExistingEpsIdempotency(input.organizationId, idempotencyKey);
  if (existing) return existingPaymentResult(existing);

  const settings = await requireEpsSettings(input.organizationId, "gift_card");
  const { invoice, remainingCents } = await getInvoiceContext(input.organizationId, input.invoiceId);
  assertAmountCanApply(input.amountCents, remainingCents);

  const response = await createEpsClient(settings).giftRequest({
    method: "giftredeem",
    account: asString(settings.epsAccountNumber),
    token: input.giftCardToken,
    amount: formatCentsAsEpsAmount(input.amountCents),
    user: input.actor?.userName || input.actor?.userId || "TitanOS",
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.location ? { location: input.location } : {}),
  });
  const payment = await insertEpsPayment({
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    amountCents: input.amountCents,
    currency: asString(invoice.currency) || "USD",
    method: "other",
    status: response.approved ? "succeeded" : "failed",
    mode: "gift_card",
    epsMethod: "giftredeem",
    response,
    idempotencyKey,
    actor: input.actor,
  });
  if (response.approved) await refreshInvoiceStatus(input.invoiceId);
  await audit({
    organizationId: input.organizationId,
    actor: input.actor,
    actionType: response.approved ? "eps_gift_card_sale_approved" : "eps_gift_card_sale_failed",
    entityId: input.invoiceId,
    entityName: String(invoice.invoiceNumber),
    description: response.approved ? "EPS gift card sale approved" : "EPS gift card sale failed",
    values: { paymentId: payment.id, amountCents: input.amountCents, responseCode: response.responseCode },
  });
  return { payment, response };
}

export async function runEpsFollowOn(input: {
  organizationId: string;
  action: "void" | "refund" | "capture";
  invoiceId: string;
  paymentId?: string | null;
  providerTransactionId?: string | null;
  amountCents?: number | null;
  idempotencyKey: string;
  actor?: Actor;
}): Promise<ProviderResult> {
  const mode: EpsMode = "token_cnp";
  const idempotencyKey = validateEpsIdempotencyKey(input.idempotencyKey);
  const existing = await findExistingEpsIdempotency(input.organizationId, idempotencyKey);
  if (existing) return existingPaymentResult(existing);

  const settings = await requireEpsSettings(input.organizationId, mode);
  const { invoice } = await getInvoiceContext(input.organizationId, input.invoiceId);
  const original = input.paymentId
    ? (await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, input.paymentId), eq(payments.organizationId, input.organizationId), eq(payments.invoiceId, input.invoiceId)))
        .limit(1))[0]
    : null;
  const transactionId = asString(input.providerTransactionId) || asString((original as any)?.providerTransactionId);
  if (!transactionId) {
    throw new PaymentProviderError("providerTransactionId or paymentId with an EPS transaction is required.", "EPS_TRANSACTION_REQUIRED", 400);
  }
  const amountCents = Math.max(0, Math.round(Number(input.amountCents || (original as any)?.amountCents || 0)));
  if (input.action !== "void" && amountCents <= 0) {
    throw new PaymentProviderError("amountCents is required.", "INVALID_AMOUNT", 400);
  }

  const methodByAction = {
    void: "creditvoid",
    refund: "creditreturn",
    capture: "capture",
  } as const;
  const response = await createEpsClient(settings).tokenCnpRequest({
    method: methodByAction[input.action],
    account: asString(settings.epsAccountNumber),
    transactionid: transactionId,
    ...(amountCents > 0 ? { amount: formatCentsAsEpsAmount(amountCents) } : {}),
    ticketid: asString(invoice.displayNumber) || String(invoice.invoiceNumber || invoice.id),
    userid: input.actor?.userName || input.actor?.userId || "TitanOS",
    json: "no",
  });

  let paymentStatus: "failed" | "refunded" | "voided" | "captured" = "failed";
  if (response.approved) {
    paymentStatus = input.action === "refund" ? "refunded" : input.action === "void" ? "voided" : "captured";
  }
  const payment = await insertEpsPayment({
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    amountCents,
    currency: asString(invoice.currency) || "USD",
    method: "credit_card",
    status: paymentStatus,
    mode,
    epsMethod: methodByAction[input.action],
    response,
    idempotencyKey,
    actor: input.actor,
    notes: `EPS ${input.action} for transaction ${transactionId}`,
  });

  if (response.approved) await refreshInvoiceStatus(input.invoiceId);
  await audit({
    organizationId: input.organizationId,
    actor: input.actor,
    actionType: `eps_${input.action}_${response.approved ? "approved" : "failed"}`,
    entityId: input.invoiceId,
    entityName: String(invoice.invoiceNumber),
    description: `EPS ${input.action} ${response.approved ? "approved" : "failed"}`,
    values: { paymentId: payment.id, originalPaymentId: input.paymentId || null, transactionId, amountCents },
  });
  return { payment, response };
}

export async function closeEpsBatch(input: { organizationId: string; idempotencyKey: string; actor?: Actor }): Promise<{ response: EpsNormalizedResponse }> {
  validateEpsIdempotencyKey(input.idempotencyKey);
  const settings = await requireEpsSettings(input.organizationId, "token_cnp");
  const response = await createEpsClient(settings).tokenCnpRequest({
    method: "closebatch",
    account: asString(settings.epsAccountNumber),
    userid: input.actor?.userName || input.actor?.userId || "TitanOS",
    json: "no",
  });

  try {
    await db.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actor?.userId || null,
      userName: getUserName(input.actor),
      actionType: response.approved ? "eps_close_batch_approved" : "eps_close_batch_failed",
      entityType: "organization",
      entityId: input.organizationId,
      entityName: input.organizationId,
      description: response.approved ? "EPS batch close approved" : "EPS batch close failed",
      newValues: {
        responseCode: response.responseCode,
        responseMessage: response.responseMessage,
        providerTransactionId: response.providerTransactionId,
      } as any,
      createdAt: new Date(),
    } as any);
  } catch {
    // ignore
  }

  return { response };
}
