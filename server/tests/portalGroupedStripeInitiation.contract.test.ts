import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function exportedBody(file: string, name: string) {
  const text = source(file);
  const start = text.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const next = text.indexOf("\nexport ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

describe("grouped portal Stripe initiation contract", () => {
  test("keeps the endpoint behind the authenticated portal and staff-preview read-only boundaries", () => {
    const routes = source("server/routes/portal.routes.ts");
    expect(routes).toContain('app.post("/api/portal/payments/stripe/create-intent", ...portalMiddlewares, portalPost(createPortalGroupedStripePaymentIntent))');
    expect(routes).toContain("const portalMiddlewares = [isAuthenticated, portalContext, denyStaffPreviewMutations]");
  });

  test("reloads every selected invoice and derives the authoritative allocation set", () => {
    const body = exportedBody("server/services/portal.service.ts", "createPortalGroupedStripePaymentIntent");
    expect(source("server/services/portal.service.ts")).toContain("invoiceIds: z.array");
    expect(body).toContain("new Set(invoiceIds).size !== invoiceIds.length");
    expect(body).toContain("getPortalInvoiceForPayment(scope, invoiceId)");
    expect(body).toContain("assertPortalInvoicePayable(invoice, paymentRows)");
    expect(body).toContain("allocations.reduce");
    expect(body).toContain("expectedRemainingCents");
    expect(body).toContain("stale: true");
  });

  test("creates one pending parent batch and one idempotent Stripe PaymentIntent without child effects", () => {
    const body = exportedBody("server/services/portal.service.ts", "createPortalGroupedStripePaymentIntent");
    expect(body).toContain("customerPaymentBatches");
    expect(body).toContain('status: "pending"');
    expect(body).toContain("customerPaymentBatchId: batch.id");
    expect(body).toContain("idempotencyKey: `portal-stripe-batch:${batch.id}`");
    expect(body).toContain("stripePaymentIntentId: String(paymentIntent.id)");
    expect(body).not.toContain("insert(payments)");
  });

  test("the dialog sends only invoice identifiers and displayed balance snapshots to the grouped endpoint", () => {
    const dialog = source("client/src/components/payments/StripePayDialog.tsx");
    expect(dialog).toContain("'/api/portal/payments/stripe/create-intent'");
    expect(dialog).toContain("expectedRemainingCents");
    expect(dialog).toContain("idempotencyKey: checkoutIdempotencyKeyRef.current");
    expect(dialog).toContain("'/api/portal/payments/stripe/confirm'");
  });
});
