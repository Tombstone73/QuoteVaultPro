import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isStripePaymentConfirmSucceeded,
  type StripePaymentConfirmResponse,
} from "../../shared/stripePaymentConfirm";
import { hasReconciledStripePayment } from "../../shared/stripePaymentSettlement";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Stripe immediate browser confirmation", () => {
  test("recognizes the server's typed succeeded response", () => {
    const stripeResponse: StripePaymentConfirmResponse = {
      success: true,
      data: {
        paymentStatus: "succeeded",
        updated: true,
        invoice: { id: "invoice_1" },
        rollup: { amountPaidCents: 750 },
      },
    };

    expect(isStripePaymentConfirmSucceeded(stripeResponse)).toBe(true);
  });

  test("does not claim confirmation when the server reports a recoverable failure", () => {
    const stripeResponse: StripePaymentConfirmResponse = {
      success: false,
      error: "Stripe reconciliation is temporarily unavailable",
    };

    expect(isStripePaymentConfirmSucceeded(stripeResponse)).toBe(false);
  });

  test("recognizes the authoritative Stripe payment in both full and partial payment refreshes", () => {
    const paymentIntentId = "pi_test_authoritative";

    expect(hasReconciledStripePayment([
      { stripePaymentIntentId: paymentIntentId, status: "succeeded" },
    ], paymentIntentId)).toBe(true);
    expect(hasReconciledStripePayment([
      { stripePaymentIntentId: paymentIntentId, status: "succeeded" },
      { stripePaymentIntentId: "pi_prior_payment", status: "succeeded" },
    ], paymentIntentId)).toBe(true);
    expect(hasReconciledStripePayment([
      { stripePaymentIntentId: paymentIntentId, status: "pending" },
    ], paymentIntentId)).toBe(false);
  });

  test("staff confirmation uses a server-resolved attempt identity and a versioned observation", () => {
    const route = source("server/routes/mvpInvoicing.routes.ts");

    expect(route).toContain("metadata?.stripePaymentAttemptId");
    expect(route).toContain("stripe-browser-confirm:v2:${paymentIntentId}:${type}");
    expect(route).toContain("paymentAttemptId,");
    expect(route).toContain("const response: StripePaymentConfirmSuccessResponse");
    expect(route).toContain("await captureAndApplyStripeObservation({");
    expect(route).toContain("retryStripeObservationByEvent(browserConfirmEventId)");
    expect(route).toContain('captureError?.code !== "STRIPE_EVENT_CONFLICT"');
  });

  test("portal confirmation preserves attempt identity through the same canonical reconciliation path", () => {
    const portal = source("server/services/portal.service.ts");

    expect(portal).toContain("stripe-portal-confirm:v2:${payment.stripePaymentIntentId}:payment_intent.succeeded");
    expect(portal).toContain("paymentAttemptId: typeof (payment.metadata as any)?.stripePaymentAttemptId");
    expect(portal).toContain("await captureAndApplyStripeObservation({");
  });

  test("the payment dialog waits for authoritative invoice and payment state before closing", () => {
    const dialog = source("client/src/components/payments/StripePayDialog.tsx");
    const staffInvoice = source("client/src/pages/invoice-detail.tsx");
    const portalInvoice = source("client/src/pages/portal/invoice-detail.tsx");

    expect(dialog).toContain("isStripePaymentConfirmSucceeded(confirmData)");
    expect(dialog).toContain("paymentIntentId: result.paymentIntent.id");
    expect(dialog).toContain("if (reconciled)");
    expect(dialog).toContain("awaiting processor reconciliation");
    expect(dialog).toContain("must not silently close onto a stale invoice");
    expect(staffInvoice).toContain("queryClient.invalidateQueries({ queryKey: ['invoices'] })");
    expect(staffInvoice).toContain("queryClient.invalidateQueries({ queryKey: ['invoicePayments', invoiceId] })");
    expect(staffInvoice).toContain("orderDetailQueryKey(orderId)");
    expect(staffInvoice).toContain("refreshAuthoritativePaymentState");
    expect(staffInvoice).toContain("hasReconciledStripePayment(paymentResult.data || [], paymentIntentId)");
    expect(staffInvoice).toContain("for (const delayMs of [1500, 3500, 7000, 8000, 8000, 8000, 10000, 10000, 6000])");
    expect(source("client/src/hooks/useInvoices.ts")).toContain("cache: 'no-store'");
    expect(portalInvoice).toContain("await refreshInvoiceState()");
  });
});
