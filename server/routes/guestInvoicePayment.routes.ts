import type { Express, Request, Response } from "express";
import { confirmGuestStripePayment, createGuestStripePaymentIntent, getGuestInvoice, getGuestStripeRuntimeConfig } from "../services/guestInvoicePayment.service";

function sendError(res: Response, error: any) {
  const status = Number(error?.statusCode || 404);
  const safeMessage = status === 400 || status === 409 || status === 502
    ? String(error.message || "Unable to process this invoice payment.")
    : "Invoice payment link is invalid or expired.";
  return res.status(status).json({ success: false, message: safeMessage });
}
export function registerGuestInvoicePaymentRoutes(app: Express) {
  app.get("/api/guest/invoices/:token", async (req, res) => { try { const data = await getGuestInvoice(req.params.token); return data ? res.setHeader("Referrer-Policy", "no-referrer").json({ success: true, data }) : res.status(404).json({ success: false, message: "Invoice payment link is invalid or expired." }); } catch (e) { return sendError(res, e); } });
  app.get("/api/guest/invoices/:token/payments/stripe/runtime-config", async (req, res) => { try { const data = await getGuestStripeRuntimeConfig(req.params.token); return data ? res.json({ success: true, data }) : res.status(404).json({ success: false }); } catch (e) { return sendError(res, e); } });
  app.post("/api/guest/invoices/:token/payments/stripe/create-intent", async (req, res) => { try { const data = await createGuestStripePaymentIntent(req.params.token); return data ? res.json({ success: true, data }) : res.status(404).json({ success: false }); } catch (e) { return sendError(res, e); } });
  app.post("/api/guest/invoices/:token/payments/stripe/confirm", async (req, res) => { try { const data = await confirmGuestStripePayment(req.params.token, String(req.body?.paymentIntentId || "")); return data ? res.json({ success: true, data }) : res.status(404).json({ success: false }); } catch (e) { return sendError(res, e); } });
}
