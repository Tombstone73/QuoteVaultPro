import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { FinancialInvoiceRead } from "./api";
import { FinanceWorkspace, invoiceDocumentPath } from "./FinanceWorkspace";

const money = (cents: number) => ({ cents, currency: "USD" });
const read = (lifecycle: "draft" | "issued", balanceCents = 600, paidCents = 0): FinancialInvoiceRead => ({
  invoice: {
    source: "v2",
    invoiceId: `invoice-${lifecycle}`,
    organizationId: "org-a",
    sourceOrderId: "order-a",
    sourceOrderNumber: lifecycle === "draft" ? "ORD-1010" : "ORD-1007",
    customerId: "customer-a",
    customerPresentation: { customerDisplayName: "QA Customer" },
    lifecycle,
    synchronizationVersion: "version-a",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    currency: "USD",
    lines: [{
      sourceOrderLineId: "line-a",
      productId: "product-a",
      description: "Frozen sign",
      quantity: 1,
      sellingUnitAmount: money(600),
      lineAmount: money(600),
    }],
    subtotal: money(600),
    taxTotal: money(0),
    total: money(600),
  },
  settlement: {
    gross: money(600),
    paid: money(paidCents),
    refunded: money(0),
    balance: money(balanceCents),
  },
  history: [],
});

const renderInvoice = (
  lifecycle: "draft" | "issued",
  canInvoiceView = true,
  balanceCents = 600,
  paidCents = 0,
) => {
  const client = new QueryClient();
  const value = read(lifecycle, balanceCents, paidCents);
  client.setQueryData(
    [
      "v2",
      "scope-a",
      "org-a",
      "finance",
      "invoice",
      "v2",
      value.invoice.invoiceId,
    ],
    value,
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <FinanceWorkspace
        mode="invoices"
        organizationId="org-a"
        sessionScope="scope-a"
        invoiceId={value.invoice.invoiceId}
        onSelectInvoice={() => {}}
        backToInvoices={() => {}}
        canInvoiceView={canInvoiceView}
        canInvoiceSend
        canPaymentView
        canPaymentRecord
        canRefundIssue
        csrfReady
        openOrder={() => {}}
        openCustomer={() => {}}
      />
    </QueryClientProvider>,
  );
};

assert.equal(
  invoiceDocumentPath("org a", "invoice/a"),
  "/v2/organizations/org%20a/invoices/invoice%2Fa/document.pdf",
);
const draft = renderInvoice("draft");
assert.match(draft, />Preview PDF</);
assert.match(draft, /Order-backed/);
assert.match(draft, />Take Payment</);
assert.match(draft, />Pay by Card</);
assert.doesNotMatch(draft, />Issue Invoice</);
assert.match(draft, /Order ORD-1010/);
assert.doesNotMatch(draft, /Order invoice-draft/);
const issued = renderInvoice("issued");
assert.match(issued, />Preview PDF</);
assert.match(issued, /Issued Billing checkpoint; commercial content is immutable/);
assert.match(issued, />Take Payment</);
assert.doesNotMatch(issued, />Sync to QuickBooks</);
assert.doesNotMatch(issued, />Issue Invoice</);
const paid = renderInvoice("draft", true, 0, 600);
assert.doesNotMatch(paid, />Take Payment</);
assert.doesNotMatch(paid, />Pay by Card</);
const creditDue = renderInvoice("draft", true, -50, 650);
assert.match(creditDue, /Credit \/ refund due/);
assert.doesNotMatch(creditDue, />Take Payment</);
assert.doesNotMatch(creditDue, />Pay by Card</);
assert.doesNotMatch(renderInvoice("draft", false), />Preview PDF</);
const noSelection = renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <FinanceWorkspace
      mode="invoices"
      organizationId="org-a"
      sessionScope="scope-a"
      invoiceId=""
      onSelectInvoice={() => {}}
      backToInvoices={() => {}}
      canInvoiceView
      canInvoiceSend
      canPaymentView={false}
      canPaymentRecord
      canRefundIssue
      csrfReady
      openOrder={() => {}}
      openCustomer={() => {}}
    />
  </QueryClientProvider>,
);
assert.doesNotMatch(noSelection, />Preview PDF</);
const workspaceSource = readFileSync("v2/ui/src/FinanceWorkspace.tsx", "utf8");
const apiSource = readFileSync("v2/ui/src/api.ts", "utf8");
assert.doesNotMatch(workspaceSource, /QuickBooks sync/);
assert.doesNotMatch(workspaceSource, /Retry Payment Sync/);
assert.doesNotMatch(workspaceSource, /invoiceApi\.issue/);
assert.match(workspaceSource, /settlement\?\.balance\.cents \?\? 0\) > 0/);
assert.match(apiSource, /settings\/accounting\/sync-selected/);
assert.match(workspaceSource, /selectInvoice\(row\.invoiceId, row\.source\)/, "the Invoice grid opens with the canonical V2 Invoice ID");
assert.match(workspaceSource, /if \(invoiceId\) \{ setSelected\(invoiceId\); setSelectedSource\("v2"\); \}/, "a direct Invoice route preserves its canonical selection through workspace initialization");
assert.match(workspaceSource, /loadStripe\(publishableKey,\{stripeAccount:stripeAccountId\}\)/, "Payment Element must bind the server-selected connected account for direct charges");
console.log("FinanceWorkspace invoice PDF action tests passed.");
