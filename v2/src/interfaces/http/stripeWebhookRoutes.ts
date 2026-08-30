import type { Request, Response } from "express";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { StripeProviderIngress } from "../../../infrastructure/billing/stripeProviderIngress.js";

/** The raw-body route is mounted before JSON parsing by the V2 composition root. */
export const createStripeWebhookHandler = (ingress: StripeProviderIngress) => async (request: Request, response: Response) => {
  try {
    const body = request.body;
    if (!Buffer.isBuffer(body)) throw new V2ApplicationError("VALIDATION_ERROR", "Stripe webhook must use an application/json raw body.");
    const signature = typeof request.header("stripe-signature") === "string" ? request.header("stripe-signature") : undefined;
    const result = await ingress.receive(body, signature);
    return response.status(200).json({ ok: true, data: { disposition: result.disposition } });
  } catch (error) {
    // Signature and malformed-payload failures are permanent; domain failures
    // intentionally return 500 so Stripe retries the signed event safely.
    if (error instanceof V2ApplicationError && error.code === "VALIDATION_ERROR") return response.status(400).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
    return response.status(500).json({ ok: false, error: { code: "RETRYABLE_FAILURE", message: "Stripe event could not be reconciled." } });
  }
};
