import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Stripe PaymentIntent attempt safety", () => {
  test("staff and portal reserve a durable attempt instead of deriving idempotency from amount or terminal history", () => {
    const staff = source("server/routes/mvpInvoicing.routes.ts");
    const portal = source("server/services/portal.service.ts");
    const attempts = source("server/services/stripePaymentAttempt.service.ts");
    const schema = source("shared/schema.ts");

    expect(staff).toContain("reserveStripePaymentAttempt");
    expect(portal).toContain("reserveStripePaymentAttempt");
    expect(staff).toContain("recordStripePaymentAttemptIntent");
    expect(portal).toContain("recordStripePaymentAttemptIntent");
    expect(staff).not.toContain("terminalAttempts.length");
    expect(portal).not.toContain("terminalAttempts.length");
    expect(attempts).toContain("stripe-payment-attempt:${attemptId}");
    expect(schema).toContain("stripe_payment_attempts_one_active_invoice_uidx");
    expect(attempts).toContain("findActiveStripePaymentAttempt");
  });

  test("signed reconciliation terminalizes attempts and repairs a crash between Stripe acceptance and local intent persistence", () => {
    const reconciliation = source("server/services/stripePaymentReconciliationService.ts");
    const webhook = source("server/routes/mvpInvoicing.routes.ts");

    expect(reconciliation).toContain("stripePaymentAttempts");
    expect(reconciliation).toContain("paymentAttemptId");
    expect(reconciliation).toContain("stripePaymentIntentId: paymentIntentId");
    expect(reconciliation).toContain("status: effect");
    expect(webhook).toContain("stripePaymentAttemptId");
  });

  test("all payment paths use the shared fail-closed runtime configuration boundary", () => {
    expect(source("server/routes/stripe.routes.ts")).toContain("STRIPE_MODE_MISMATCH");
    expect(source("server/routes/mvpInvoicing.routes.ts")).toContain("resolveStripeRuntimeConfig(organizationId)");
    expect(source("server/services/portal.service.ts")).toContain("resolveStripeRuntimeConfig(organizationId)");
  });

  test("the browser loads server-authoritative runtime config before requesting an intent", () => {
    const dialog = source("client/src/components/payments/StripePayDialog.tsx");
    expect(dialog).not.toContain("VITE_STRIPE_PUBLISHABLE_KEY");
    expect(dialog).toContain("/payments/stripe/runtime-config");
    expect(dialog.indexOf("/payments/stripe/runtime-config")).toBeLessThan(dialog.indexOf("/payments/stripe/create-intent"));
  });
});
