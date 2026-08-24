import type { Express } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import {
  createHostedSession,
  getPaymentSettings,
  PaymentProviderError,
  recordHostedResult,
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

function hasPaymentRecordPermission(user: any): boolean {
  const role = String(user?.role || user?.orgRole || "").trim().toLowerCase();
  if (["owner", "admin", "manager", "staff", "employee"].includes(role)) return true;

  const permissions = Array.isArray(user?.permissions) ? user.permissions.map((permission: unknown) => String(permission).toLowerCase()) : [];
  if (permissions.includes("payments.record") || permissions.includes("payments:record") || permissions.includes("payment:record")) {
    return true;
  }

  const paymentPermissions = user?.paymentPermissions || user?.payments;
  if (paymentPermissions && typeof paymentPermissions === "object" && paymentPermissions.record === true) return true;

  return false;
}

function requirePaymentRecordPermission(req: any, res: any, next: any) {
  if (hasPaymentRecordPermission(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: "PAYMENT_PERMISSION_REQUIRED",
    error: "Recording EPS hosted payment results requires a staff/admin user with payment permission.",
  });
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

export const EPS_PHASE1_DISABLED_MESSAGE =
  "This EPS action is disabled in Phase 1. It requires EPS certification documentation and official status/callback handling before activation.";

export function sendEpsPhase1Disabled(res: any, action: string) {
  return res.status(501).json({
    success: false,
    code: "EPS_PHASE1_DISABLED",
    error: EPS_PHASE1_DISABLED_MESSAGE,
    data: {
      action,
      enabledPhase1Modes: ["hosted_cnp"],
      requiredBeforeActivation: ["EPS certification docs", "official EPS status or callback handling"],
    },
  });
}

const paymentSettingsPatchSchema = z.object({
  provider: z.enum(["none", "stripe", "eps"]).optional(),
  stripeEnabled: z.boolean().optional(),
  epsEnabled: z.boolean().optional(),
  epsMode: z.enum(["test", "live"]).optional(),
  epsTestAccountNumber: z.string().trim().max(100).nullable().optional(),
  epsTestApiKey: z.string().trim().max(500).nullable().optional(),
  epsTestBaseUrl: z.string().url().optional(),
  epsLiveAccountNumber: z.string().trim().max(100).nullable().optional(),
  epsLiveApiKey: z.string().trim().max(500).nullable().optional(),
  epsLiveBaseUrl: z.string().url().optional(),
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

const recordHostedResultSchema = z.object({
  paymentId: z.string().trim().min(1),
  epsTransactionId: z.string().trim().max(160).optional().nullable(),
  authCode: z.string().trim().max(100).optional().nullable(),
  tokenLast4: z.string().trim().regex(/^\d{4}$/, "EPS card last four digits must contain exactly four digits.").optional().nullable(),
  approvedAmountCents: z.coerce.number().int().min(0),
  responseCode: z.string().trim().max(100).optional().nullable(),
  responseMessage: z.string().trim().max(500).optional().nullable(),
  internalNote: z.string().trim().max(2000).optional().nullable(),
  result: z.enum(["approved", "failed", "canceled"]),
  amountOverride: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.result !== "approved") return;
  if (!value.epsTransactionId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["epsTransactionId"], message: "EPS transaction id is required for an approved hosted payment." });
  if (!value.authCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ["authCode"], message: "EPS auth code is required for an approved hosted payment." });
  if (!value.tokenLast4) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tokenLast4"], message: "EPS card last four digits are required for an approved hosted payment." });
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
      const settings = await updatePaymentSettings(organizationId, {
        ...body,
        epsSupportedModes: ["hosted_cnp"],
      } as any);
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

  app.post("/api/payments/eps/record-hosted-result", isAuthenticated, tenantContext, requirePaymentRecordPermission, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
    try {
      const body = recordHostedResultSchema.parse(req.body || {});
      const data = await recordHostedResult({ ...body, organizationId, actor: getActor(req) });
      return res.json({ success: true, data });
    } catch (error: any) {
      return sendPaymentError(res, error, { route: "POST /api/payments/eps/record-hosted-result", organizationId });
    }
  });

  app.post("/api/payments/eps/token-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "token-sale");
  });

  app.post("/api/payments/eps/card-present-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "card-present-sale");
  });

  app.post("/api/payments/eps/ach-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "ach-sale");
  });

  app.post("/api/payments/eps/gift-card-sale", isAuthenticated, tenantContext, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "gift-card-sale");
  });

  app.post("/api/payments/eps/void", isAuthenticated, tenantContext, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "void");
  });

  app.post("/api/payments/eps/refund", isAuthenticated, tenantContext, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "refund");
  });

  app.post("/api/payments/eps/capture", isAuthenticated, tenantContext, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "capture");
  });

  app.post("/api/payments/eps/close-batch", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    return sendEpsPhase1Disabled(res, "close-batch");
  });
}
