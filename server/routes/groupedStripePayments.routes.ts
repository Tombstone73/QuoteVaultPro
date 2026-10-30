import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import { requireInvoiceBulkAction } from "../lib/invoiceBulkActionAuthority";
import { resolveStripeRuntimeConfig } from "../services/stripeRuntimeConfig.service";
import { prepareFullBalanceStripePayment, initiateFullBalanceStripePayment, validateGroupedStripePayment,
  confirmGroupedStripePayment, readGroupedStripePayment } from "../services/billing/groupedStripePaymentOperations";
import { previewCustomerPayment } from "../services/billing/customerPaymentOperations";
import { recoverStripeInvoiceClaims } from "../services/stripeInvoicePaymentClaims.service";

const selection = z.object({ invoiceIds: z.array(z.string().trim().min(1)).min(1).max(50) });
const initiation = selection.extend({ idempotencyKey: z.string().trim().min(8).max(200),
  expectedRemainingCents: z.record(z.string(), z.number().int().positive()) });
const intent = z.object({ paymentIntentId: z.string().trim().min(1) });

export function registerGroupedStripePaymentRoutes(app: Express, deps: { isAuthenticated: RequestHandler; tenantContext: RequestHandler }) {
  const boundary = [deps.isAuthenticated, deps.tenantContext, requireInvoiceBulkAction("payment")];
  const post = (path: string, work: (req: any, organizationId: string, actorUserId: string) => Promise<unknown>) => {
    app.post("/api/invoices/customer-payment/stripe/" + path, ...boundary, async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        const actorUserId = String(req.user?.claims?.sub ?? req.user?.id ?? "");
        if (!actorUserId) return res.status(401).json({ success: false, error: "Authentication required." });
        const data = await work(req, organizationId, actorUserId);
        return res.json({ success: true, data });
      } catch (error: any) {
        return res.status(error?.statusCode || (error?.name === "ZodError" ? 400 : 500))
          .json({ success: false, error: error.message || "Unable to process payment.", code: error.code, blockedInvoice: error.blockedInvoice });
      }
    });
  };
  post("runtime-config", async (req, organizationId) => {
    const body = selection.parse(req.body);
    await prepareFullBalanceStripePayment(organizationId, body.invoiceIds);
    const config = await resolveStripeRuntimeConfig(organizationId);
    if (!config.ok) throw Object.assign(new Error(config.error), { statusCode: 409, code: config.code });
    return config.data;
  });
  post("create-intent", async (req, organizationId, actorUserId) => {
    const body = initiation.parse(req.body);
    const config = await resolveStripeRuntimeConfig(organizationId);
    if (!config.ok) throw Object.assign(new Error(config.error), { statusCode: 409, code: config.code });
    return initiateFullBalanceStripePayment({ organizationId, actorUserId, invoiceIds: body.invoiceIds,
      expectedRemainingCents: body.expectedRemainingCents, requestKey: body.idempotencyKey, stripeAccountId: config.data.connectedAccountId });
  });
  post("validate", async (req, organizationId) => validateGroupedStripePayment({ organizationId, ...intent.parse(req.body) }));
  post("confirm", async (req, organizationId, actorUserId) => confirmGroupedStripePayment({ organizationId, actorUserId, ...intent.parse(req.body) }));
  post("status", async (req, organizationId) => readGroupedStripePayment({ organizationId, ...intent.parse(req.body) }));
  post("recover", async (req, organizationId) => {
    const body = selection.parse(req.body);
    const authorized = await previewCustomerPayment({ organizationId, invoiceIds: body.invoiceIds, amountCents: 1,
      allocationMode: "oldest_first", staffSelection: true });
    return recoverStripeInvoiceClaims({ organizationId, invoiceIds: body.invoiceIds, customerId: authorized.customerId as string, cancelUnfunded: true });
  });
}
