import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readPortalFrontendSource(): string {
  const files = [
    "client/src/hooks/usePortal.ts",
    "client/src/pages/portal/dashboard.tsx",
    "client/src/pages/portal/documents.tsx",
    "client/src/pages/portal/invoice-detail.tsx",
    "client/src/pages/portal/invoices.tsx",
    "client/src/pages/portal/my-orders.tsx",
    "client/src/pages/portal/order-detail.tsx",
    "client/src/pages/portal/proofs.tsx",
    "client/src/pages/portal/proof-detail.tsx",
    "client/src/pages/portal/my-quotes.tsx",
    "client/src/pages/portal/quote-detail.tsx",
    "client/src/components/portal/PortalLayout.tsx",
    "client/src/components/portal/PortalFilesCard.tsx",
  ];

  return files.map((file) => `\n/* ${file} */\n${read(file)}`).join("\n");
}

describe("portal frontend API boundary", () => {
  test("portal-owned invoice/order/quote surfaces do not call internal APIs", () => {
    const source = readPortalFrontendSource();

    expect(source).not.toContain("/api/invoices");
    expect(source).not.toContain("/api/orders");
    expect(source).not.toContain("/api/quotes");
    expect(source).not.toContain("customerId=");
    expect(source).not.toContain("/api/portal/my-orders");
    expect(source).not.toContain("/api/portal/my-quotes");
    expect(source).not.toContain("/api/portal/products");
    expect(source).not.toContain("/api/portal/convert-quote");
    expect(source).not.toContain("/api/proofing");
    expect(source).not.toContain("/api/objects");
  });

  test("portal invoice payment UI is wired to portal-safe payment endpoints", () => {
    const invoiceDetail = read("client/src/pages/portal/invoice-detail.tsx");
    const stripeDialog = read("client/src/components/payments/StripePayDialog.tsx");

    expect(invoiceDetail).toContain('apiBasePath="/api/portal/invoices"');
    expect(stripeDialog).toContain("/payments/stripe/create-intent");
    expect(stripeDialog).toContain("/payments/stripe/confirm");
  });

  test("portal payment settlement refreshes invoice list, detail, and payments", () => {
    const invoiceDetail = read("client/src/pages/portal/invoice-detail.tsx");

    expect(invoiceDetail).toContain("portalInvoiceKeys.all");
    expect(invoiceDetail).toContain("portalInvoiceKeys.detail(invoiceId)");
    expect(invoiceDetail).toContain("portalInvoiceKeys.payments(invoiceId)");
    expect(invoiceDetail).toContain("window.setTimeout(() => void refreshInvoiceState(), 1500)");
    expect(invoiceDetail).toContain("window.setTimeout(() => void refreshInvoiceState(), 5000)");
  });

  test("payment debug logging does not print raw Stripe secrets or PaymentIntent IDs", () => {
    const stripeDialog = read("client/src/components/payments/StripePayDialog.tsx");

    expect(stripeDialog).not.toContain("paymentIntentId: result.paymentIntent?.id");
    expect(stripeDialog).not.toContain("clientSecret.slice");
    expect(stripeDialog).not.toContain("stripeAccountId: props.stripeAccountId");
  });
});
