import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Stripe refund route contract", () => {
  const route = source("server/routes/mvpInvoicing.routes.ts");
  const reconciliation = source("server/services/stripePaymentReconciliationService.ts");

  test("uses the canonical authenticated invoice payment path and client request identity", () => {
    expect(route).toContain("/api/invoices/:invoiceId/payments/:paymentId/stripe/refund");
    expect(route).toContain("req.headers['idempotency-key']");
    expect(route).toContain("stripeRefundIdempotencyKey");
  });

  test("fails closed on tenant and connected-account context mismatches", () => {
    expect(route).toContain("eq(payments.organizationId, organizationId)");
    expect(route).toContain("STRIPE_REFUND_CONNECTED_ACCOUNT_MISMATCH");
    expect(route).toContain("STRIPE_REFUND_PAYMENT_CONTEXT_MISMATCH");
    expect(route).toContain("stripeAccount: stripeAccountId");
  });

  test("reserves idempotent work without changing invoice payment effects", () => {
    expect(route).toContain("stripeRefundRequests");
    expect(route).toContain("pg_advisory_xact_lock");
    expect(route).toContain("status: 'pending_reconciliation'");
    expect(route).not.toContain("status: 'refunded',\n          amount: (refundInput");
  });

  test("keeps webhook reconciliation authoritative for request settlement", () => {
    expect(reconciliation).toContain("refundRequestId");
    expect(reconciliation).toContain("STRIPE_REFUND_REQUEST_MISMATCH");
    expect(reconciliation).toContain("status: isRefundSucceeded ? \"succeeded\"");
    expect(reconciliation).toContain("status: \"refunded\"");
  });

  test("reports a terminal Stripe rejection instead of leaving the UI pending", () => {
    expect(route).toContain("const terminalFailure = ['failed', 'canceled'].includes(processorStatus)");
    expect(route).toContain("code: 'STRIPE_REFUND_REQUEST_FAILED'");
    expect(route).toContain("No local payment state was changed.");
  });
});
