import type { Express } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import {
  closeEpsBatch,
  createAchSale,
  createCardPresentSale,
  createGiftCardSale,
  createHostedSession,
  createTokenSale,
  getPaymentSettings,
  PaymentProviderError,
  runEpsFollowOn,
  updatePaymentSettings,
} from "../services/payments/paymentProvider.service";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function getActor(req: any) {
  return {
    userId: getUserId(req.user) || null,
    userName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
  };
}

function safeErrorPayload(error: any) {
  if (error instanceof PaymentProviderError) {
    return {
      statusCode: error.statusCode,
      payload: { success: false, code: error.code, error: error.message },
    };
  }
  if (error?.name === "ZodError") {
    return {
      statusCode: 400,
      payload: { success: false, code: "INVALID_REQUEST", error: "Invalid request", details: error.flatten?.() ?? error.message },
    };
  }
  return {
    statusCode: Number(error?.statusCode || error?.status || 500),
    payload: { success: false, code: "PAYMENT_ERROR", error: error?.message || "Payment request failed" },
  };
}

function sendPaymentError(res: any, error: any, context: Record<string, unknown>) {
  const safe = safeErrorPayload(error);
  console.error("[Payments] request failed", {
    ...context,
    code: safe.payload.code,
    message: safe.payload.error,
  });
  return res.status(safe.statusCode).json(safe.payload);
}

const paymentSettingsPatchSchema = z.object({
  provider: z.enum(["none", "eps"]).optional(),
  epsEnabled: z.boolean().optional(),
  epsAccountNumber: z.string().trim().max(100).nullable().optional(),
  epsApiKey: z.string().trim().max(500).nullable().optional(),
  epsCnpBaseUrl: z.string().url().optional(),
  epsCardPresentBaseUrl: z.string().url().optional(),
  epsAchBaseUrl: z.string().url().optional(),
  epsGiftBaseUrl: z.string().url().optional(),
  epsDeviceSerialNumber: z.string().trim().max(100).nullable().optional(),
  epsSupportedModes: z.array(z.enum(["hosted_cnp", "token_cnp", "card_present", "ach", "gift_card"])).optional(),
});

const amountInvoiceSchema = z.object({
  invoiceId: z.string().trim().min(1),
  amountCents: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().optional().nullable(),
});

const hostedSessionSchema = amountInvoiceSchema.extend({
  idempotencyKey: z.string().trim().max(160).optional().nullable(),
});

const tokenSaleSchema = amountInvoiceSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(160),
  token: z.string().trim().min(1).max(500),
  expirationDate: z.string().trim().min(3).max(10),
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  zip: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  paySource: z.string().trim().max(32).optional().nullable(),
});

const achSaleSchema = amountInvoiceSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(160),
  checkAccount: z.string().trim().min(1).max(64),
  checkRouting: z.string().trim().min(1).max(64),
  checkType: z.string().trim().max(32).default("Checking"),
  paySource: z.enum(["CCD", "PPD", "WEB"]).default("WEB"),
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  business: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  address2: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(32).optional().nullable(),
  zip: z.string().trim().max(32).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
});

const giftCardSaleSchema = amountInvoiceSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(160),
  giftCardToken: z.string().trim().min(1).max(128),
  owner: z.string().trim().max(100).optional().nullable(),
  location: z.string().trim().max(100).optional().nullable(),
});

const followOnSchema = z.object({
  invoiceId: z.string().trim().min(1),
  paymentId: z.string().trim().optional().nullable(),
  providerTransactionId: z.string().trim().optional().nullable(),
  amountCents: z.coerce.number().int().positive().optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(160),
});

const closeBatchSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
});

export function registerPaymentProviderRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner } = middleware;

  app.get("/api/payment-settings", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const settings = await getPaymentSettings(organizationId);
      return res.json({ success: true, data: settings });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "GET /api/payment-settings", organizationId });
    }
  });

  app.patch("/api/payment-settings", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = paymentSettingsPatchSchema.parse(req.body || {});
      const settings = await updatePaymentSettings(organizationId, body as any);
      return res.json({ success: true, data: settings });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "PATCH /api/payment-settings", organizationId });
    }
  });

  app.post("/api/payments/eps/hosted-session", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = hostedSessionSchema.parse(req.body || {});
      const data = await createHostedSession({ ...body, organizationId, actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/hosted-session", organizationId });
    }
  });

  app.post("/api/payments/eps/token-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = tokenSaleSchema.parse(req.body || {});
      const data = await createTokenSale({ ...body, organizationId, actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/token-sale", organizationId });
    }
  });

  app.post("/api/payments/eps/card-present-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = amountInvoiceSchema.extend({ idempotencyKey: z.string().trim().min(8).max(160) }).parse(req.body || {});
      const data = await createCardPresentSale({ ...body, organizationId, actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/card-present-sale", organizationId });
    }
  });

  app.post("/api/payments/eps/ach-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = achSaleSchema.parse(req.body || {});
      const data = await createAchSale({ ...body, organizationId, actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/ach-sale", organizationId });
    }
  });

  app.post("/api/payments/eps/gift-card-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = giftCardSaleSchema.parse(req.body || {});
      const data = await createGiftCardSale({ ...body, organizationId, actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/gift-card-sale", organizationId });
    }
  });

  app.post("/api/payments/eps/void", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = followOnSchema.parse(req.body || {});
      const data = await runEpsFollowOn({ ...body, organizationId, action: "void", actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/void", organizationId });
    }
  });

  app.post("/api/payments/eps/refund", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = followOnSchema.parse(req.body || {});
      const data = await runEpsFollowOn({ ...body, organizationId, action: "refund", actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/refund", organizationId });
    }
  });

  app.post("/api/payments/eps/capture", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = followOnSchema.parse(req.body || {});
      const data = await runEpsFollowOn({ ...body, organizationId, action: "capture", actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/capture", organizationId });
    }
  });

  app.post("/api/payments/eps/close-batch", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = closeBatchSchema.parse(req.body || {});
      const data = await closeEpsBatch({ ...body, organizationId, actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/close-batch", organizationId });
    }
  });
}
