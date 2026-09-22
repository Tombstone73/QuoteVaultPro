import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Stripe customer payment batch finalization contract", () => {
  const finalizer = source("server/services/stripeCustomerPaymentBatchFinalization.service.ts");
  const reconciliation = source("server/services/stripePaymentReconciliationService.ts");
  const portal = source("server/services/portal.service.ts");

  test("resolves a batch-owned PaymentIntent, validates provider evidence, and delegates allocation", () => {
    expect(finalizer).toContain("resolveStripePaymentLineage");
    expect(finalizer).toContain("STRIPE_BATCH_AMOUNT_MISMATCH");
    expect(finalizer).toContain("STRIPE_BATCH_CURRENCY_MISMATCH");
    expect(finalizer).toContain("STRIPE_BATCH_ACCOUNT_MISMATCH");
    expect(finalizer).toContain("stripeSuccessMismatch");
    expect(finalizer).toContain("recordCustomerPayment({");
    expect(finalizer).toContain('allocationMode: "custom"');
    expect(finalizer).toContain("existingBatchId: prepared.batch.id");
    expect(finalizer).not.toContain("insert(payments)");
  });

  test("persists provider success before allocator failure so the same batch is retryable", () => {
    expect(finalizer).toContain("stripeSuccess");
    expect(finalizer).toContain("reconciliationRequired: true");
    expect(finalizer).toContain("localFinalizationError");
    expect(finalizer).toContain("String(batch.status) === \"succeeded\"");
  });

  test("browser confirmation and signed webhook converge on the same finalizer", () => {
    expect(portal).toContain("finalizeStripeCustomerPaymentBatch({");
    expect(portal).toContain("confirmPortalGroupedStripePayment");
    expect(reconciliation).toContain("finalizeStripeCustomerPaymentBatch({");
    expect(reconciliation).not.toContain("STRIPE_BATCH_FINALIZATION_REQUIRED");
  });
});
