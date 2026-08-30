import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { FinancialInvoiceRead } from "./api";
import { FinanceWorkspace, invoiceDocumentPath } from "./FinanceWorkspace";

const money = (cents: number) => ({ cents, currency: "USD" });
const read = (lifecycle: "draft" | "issued"): FinancialInvoiceRead => ({
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
    paid: money(0),
    refunded: money(0),
    balance: money(600),
  },
  history: [],
});

const renderInvoice = (
  lifecycle: "draft" | "issued",
  canInvoiceView = true,
) => {
  const client = new QueryClient();
  const value = read(lifecycle);
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
        canIssue
        canInvoiceView={canInvoiceView}
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
assert.match(draft, />Issue Invoice</);
assert.match(draft, /Order ORD-1010/);
assert.doesNotMatch(draft, /Order invoice-draft/);
const issued = renderInvoice("issued");
assert.match(issued, />Preview PDF</);
assert.match(issued, /Issued Billing checkpoint; commercial content is immutable/);
assert.match(issued, />Take Payment</);
assert.match(issued, />Sync to QuickBooks</);
assert.doesNotMatch(issued, />Issue Invoice</);
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
      canIssue
      canInvoiceView
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
assert.match(workspaceSource, /Select up to 100 issued V2 Invoices/);
assert.match(workspaceSource, /syncQuickBooksSelected/);
assert.match(apiSource, /quickbooks-sync-selected/);
console.log("FinanceWorkspace invoice PDF action tests passed.");
