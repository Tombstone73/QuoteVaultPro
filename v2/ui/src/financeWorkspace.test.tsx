import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { financeApi, type FinancialInvoicePage, type FinancialInvoiceRead } from "./api";
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
  canInvoiceIssue = true,
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
        canInvoiceIssue={canInvoiceIssue}
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
assert.match(draft, />Issue Invoice</);
assert.match(draft, /Order ORD-1010/);
assert.doesNotMatch(draft, /Order invoice-draft/);
const issued = renderInvoice("issued");
assert.match(issued, />Preview PDF</);
assert.match(issued, /Issued Billing checkpoint; commercial content is immutable/);
assert.match(issued, />Take Payment</);
assert.doesNotMatch(issued, />Sync to QuickBooks</);
assert.doesNotMatch(issued, />Issue Invoice</);
const paid = renderInvoice("draft", true, true, 0, 600);
assert.doesNotMatch(paid, />Take Payment</);
assert.doesNotMatch(paid, />Pay by Card</);
const creditDue = renderInvoice("draft", true, true, -50, 650);
assert.match(creditDue, /Credit \/ refund due/);
assert.doesNotMatch(creditDue, />Take Payment</);
assert.doesNotMatch(creditDue, />Pay by Card</);
assert.doesNotMatch(renderInvoice("draft", false), />Preview PDF</);
assert.doesNotMatch(renderInvoice("draft", true, false), />Issue Invoice/);
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
const appSource = readFileSync("v2/ui/src/App.tsx", "utf8");
assert.doesNotMatch(workspaceSource, /QuickBooks sync/);
assert.doesNotMatch(workspaceSource, /Retry Payment Sync/);
assert.match(workspaceSource, /invoiceApi\.issue/, "draft issuance must call the canonical billing command");
assert.match(workspaceSource, /settlement\?\.balance\.cents \?\? 0\) > 0/);
assert.match(apiSource, /settings\/accounting\/sync-selected/);
assert.match(workspaceSource, /selectInvoice\(row\.invoiceId, row\.source\)/, "the Invoice grid opens with the canonical V2 Invoice ID");
assert.match(workspaceSource, /if \(invoiceId\) \{ setSelected\(invoiceId\); setSelectedSource\("v2"\); \}/, "a direct Invoice route preserves its canonical selection through workspace initialization");
assert.match(workspaceSource, /loadStripe\(publishableKey,\{stripeAccount:stripeAccountId\}\)/, "Payment Element must bind the server-selected connected account for direct charges");
assert.match(workspaceSource, /setEmailInvoiceIds\(invoiceIds\)/, "email admission snapshots the selected invoices before opening its preview");
assert.match(workspaceSource, /setEmailRequestId\(newBusinessRequestId\(\)\)/, "email admission keeps one stable request identity across pending state and retry");
assert.match(workspaceSource, /emailAdmissionError && <p className="notice error" role="alert">/, "email admission failures remain visible in the dialog");
assert.match(workspaceSource, /<p role="status">\{emailAdmission\.queuedInvoices\}/, "email admission success reports queued work in the dialog");
assert.match(workspaceSource, /disabled=\{!csrfReady \|\| !emailRequestId \|\| !emailInvoiceIds\.length \|\| emailSelected\.isPending/, "email admission prevents duplicate submission while pending");
assert.match(apiSource, /Invoice email admission returned an invalid response\. No email was queued\./, "an invalid admission response is surfaced as an actionable failure");
assert.match(workspaceSource, /"finance", "overview", invoiceQuery/, "Finance pages cache by the complete server query");
assert.match(workspaceSource, /Select visible invoices/, "select-visible is explicitly page scoped");
assert.match(workspaceSource, /Selection cleared because the invoice search or filters changed\./, "filter changes cannot leave ambiguous hidden selections");
assert.match(workspaceSource, /serverSorting=\{\{ id: invoiceSort, direction: invoiceSortDirection \}\}/, "invoice sorting is delegated to the server query");
assert.match(workspaceSource, /overview\.data\.totalMatching/, "Finance renders the authoritative matching count");
assert.match(apiSource, /financeEndpoint\(organizationId, `\/overview\$\{suffix\}`\)/, "the API carries query parameters to the paged overview route");
const financeOpenOrder = appSource.slice(appSource.indexOf("openOrder={(id) => {"), appSource.indexOf("openCustomer={(id) => {", appSource.indexOf("openOrder={(id) => {")));
assert.match(financeOpenOrder, /pushOrderLocation\(id\);\s*setOrderId\(id\);\s*setPage\("orders"\);/, "opening a source Order from Finance updates both the URL and the active workspace");
console.log("FinanceWorkspace invoice PDF action tests passed.");

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const originalInvoice: FinancialInvoiceRead = {
  ...read("issued"),
  persistedInvoiceNumber: "ORD-1010",
  invoice: { ...read("issued").invoice, invoiceId: "invoice-original", invoiceNumber: "ORD-1010", sourceOrderNumber: "ORD-1010" },
};
const replacementInvoice: FinancialInvoiceRead = {
  ...originalInvoice,
  persistedInvoiceNumber: "ORD-1010-B",
  invoice: { ...originalInvoice.invoice, invoiceId: "invoice-replacement", invoiceNumber: "ORD-1010-B" },
};
const invoicePage: FinancialInvoicePage = {
  items: [originalInvoice, replacementInvoice].map(({ invoice, settlement, persistedInvoiceNumber }) => ({
    source: "v2", recordId: invoice.invoiceId, invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, persistedInvoiceNumber,
    sourceOrderId: invoice.sourceOrderId, sourceOrderNumber: invoice.sourceOrderNumber!, customerId: invoice.customerId,
    customerName: "QA Customer", lifecycle: invoice.lifecycle, currency: invoice.currency, settlement: "unpaid", updatedAt: invoice.updatedAt,
    ...settlement,
  })),
  page: 1, pageSize: 25, totalMatching: 2, hasNextPage: false,
  summary: { totalMatching: 2, outstanding: [money(1200)], openInvoiceCount: 2,
    unpaid: { count: 2, balance: [money(1200)] }, partiallyPaid: { count: 0, balance: [] },
    paid: { count: 0, balance: [] }, creditDue: { count: 0, balance: [] } },
};
const emptyPage: FinancialInvoicePage = { ...invoicePage, items: [], totalMatching: 0,
  summary: { ...invoicePage.summary, totalMatching: 0, outstanding: [], openInvoiceCount: 0, unpaid: { count: 0, balance: [] } } };
type WorkspaceProps = React.ComponentProps<typeof FinanceWorkspace>;
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://ui.invalid/invoices" });
const previousGlobals = new Map(["window", "document", "localStorage", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalApi = { overview: financeApi.overview, invoice: financeApi.invoice, legacyInvoice: financeApi.legacyInvoice };
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
  localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const mount = async (overrides: Partial<WorkspaceProps> = {}, page = invoicePage) => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const reads: { organizationId: string; invoiceId: string; result: ReturnType<typeof deferred<FinancialInvoiceRead>> }[] = [];
  const selections: string[] = [], orders: string[] = [];
  let backCount = 0, overviewCount = 0;
  financeApi.overview = async () => { overviewCount++; return page; };
  financeApi.invoice = async (organizationId, invoiceId) => {
    const result = deferred<FinancialInvoiceRead>(); reads.push({ organizationId, invoiceId, result }); return result.promise;
  };
  financeApi.legacyInvoice = financeApi.invoice;
  let props: WorkspaceProps = {
    mode: "invoices", organizationId: "org-a", sessionScope: "scope-a", invoiceId: "invoice-original",
    onSelectInvoice: (id) => { selections.push(id); props = { ...props, invoiceId: id }; render(); },
    backToInvoices: () => { backCount++; props = { ...props, invoiceId: "" }; render(); },
    canInvoiceView: true, canInvoiceSend: false, canPaymentView: true, canPaymentRecord: true, canRefundIssue: true,
    csrfReady: true, openOrder: (id) => orders.push(id), openCustomer: () => {}, ...overrides,
  };
  const render = () => root.render(<QueryClientProvider client={client}><FinanceWorkspace {...props} /></QueryClientProvider>);
  await act(async () => render()); await flush();
  const button = (label: string) => {
    const found = [...container.querySelectorAll("button")].find((value) => value.textContent === label);
    assert.ok(found, `Missing button: ${label}`); return found;
  };
  return {
    container, client, reads, selections, orders, button,
    get backCount() { return backCount; }, get overviewCount() { return overviewCount; },
    click: async (label: string) => { await act(async () => button(label).click()); await flush(); },
    update: async (next: Partial<WorkspaceProps>) => { props = { ...props, ...next }; await act(async () => render()); await flush(); },
    resolve: async (index: number, value: FinancialInvoiceRead) => { await act(async () => reads[index]!.result.resolve(value)); await flush(); },
    reject: async (index: number, code = "NOT_FOUND", message = "Invoice financial history was not found.") => {
      await act(async () => reads[index]!.result.reject({ code, status: code === "FORBIDDEN" ? 403 : 404, message })); await flush();
    },
    close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); },
  };
};

try {
  const view = await mount();
  try {
    assert.match(view.container.textContent!, /Loading authenticated financial history/);
    assert.equal(view.container.querySelector(".v2-finance-detail"), null);
    await view.reject(0);
    assert.equal(view.container.querySelector('[role="alert"]')?.textContent, "Invoice financial history was not found.");
    assert.doesNotMatch(view.container.textContent!, /Loading authenticated financial history/);
    assert.equal(view.client.getQueryState(["v2", "scope-a", "org-a", "finance", "invoice", "v2", "invoice-original"])?.fetchStatus, "idle");
    view.button("All invoices");
    await view.click("Retry invoice");
    assert.equal(view.reads.length, 2);
    assert.equal(view.reads[1]!.invoiceId, "invoice-original");
    assert.equal(view.container.querySelector(".v2-finance-detail"), null);
    await view.resolve(1, originalInvoice);
    assert.equal(view.container.querySelector(".v2-finance-detail h2")?.textContent, "Invoice ORD-1010");
    const rows = [...view.container.querySelectorAll(".v2-finance-grid tbody tr")];
    assert.deepEqual(rows.map((row) => row.querySelector("button")?.textContent), ["Invoice ORD-1010", "Invoice ORD-1010-B"]);
    assert.ok(rows.every((row) => row.textContent?.includes("Order ORD-1010")));
    await view.click("Invoice ORD-1010-B");
    assert.deepEqual(view.selections, ["invoice-replacement"]);
    assert.equal(view.reads[2]!.invoiceId, "invoice-replacement");
    assert.equal(view.container.querySelector(".v2-finance-detail"), null, "Switching to an unloaded Invoice cannot show the previous Invoice");
    await view.update({ invoiceId: "invoice-missing" });
    assert.equal(view.reads[3]!.invoiceId, "invoice-missing");
    await view.reject(3);
    await view.resolve(2, replacementInvoice);
    assert.equal(view.container.querySelector(".v2-finance-detail"), null, "Late previous-Invoice success cannot replace the selected error");
    assert.match(view.container.querySelector('[role="alert"]')!.textContent!, /not found/);
    await view.click("All invoices");
    assert.equal(view.backCount, 1);
    assert.equal(view.container.querySelector(".v2-finance-detail"), null, "Back leaves the list open without auto-selecting another Invoice");
    assert.equal(view.container.querySelector('[role="alert"]'), null);
    assert.equal(view.reads.length, 4);
    await view.click("Invoice ORD-1010-B");
    assert.equal(view.container.querySelector(".v2-finance-detail h2")?.textContent, "Invoice ORD-1010-B");
    assert.match(view.container.querySelector(".v2-finance-detail header")!.textContent!, /Source Order ORD-1010/);
    await view.click("Open source Order"); assert.deepEqual(view.orders, ["order-a"]);
    await view.click("Invoice ORD-1010");
    assert.deepEqual(view.selections, ["invoice-replacement", "invoice-replacement", "invoice-original"]);
    assert.equal(view.container.querySelector(".v2-finance-detail h2")?.textContent, "Invoice ORD-1010");
    console.log("PASS mounted Invoice loading, 404, explicit retry, back, switch, late response and canonical number navigation");

    await view.update({ organizationId: "org-b", sessionScope: "scope-b" });
    assert.equal(view.reads[4]!.organizationId, "org-b");
    assert.equal(view.container.querySelector(".v2-finance-detail"), null, "A new tenant/session cannot display the prior detail cache");
    await view.reject(4, "FORBIDDEN", "The principal cannot view financial history.");
    assert.match(view.container.querySelector('[role="alert"]')!.textContent!, /cannot view/);
    assert.equal(view.container.querySelector(".v2-finance-detail"), null);
    assert.doesNotMatch(view.container.textContent!, /Take Payment|Pay by Card|Preview PDF/);
    const requestCount = view.reads.length;
    await view.update({ canPaymentView: false });
    assert.match(view.container.textContent!, /do not have permission/);
    assert.equal(view.container.querySelector("button"), null);
    assert.equal(view.reads.length, requestCount);
    console.log("PASS mounted Invoice tenant/session cache isolation and permission denial");
  } finally { await view.close(); }

  const empty = await mount({ invoiceId: "" }, emptyPage);
  try {
    assert.match(empty.container.textContent!, /0 matching invoices/);
    assert.equal(empty.reads.length, 0);
    assert.equal(empty.container.querySelector(".v2-finance-detail"), null);
    assert.doesNotMatch(empty.container.textContent!, /Loading authenticated financial history|Retry invoice/);
  } finally { await empty.close(); }
  const denied = await mount({ canPaymentView: false });
  try { assert.equal(denied.reads.length, 0); assert.equal(denied.overviewCount, 0); }
  finally { await denied.close(); }
  for (const example of [
    { source: "v2", lifecycle: "issued", id: "native-missing", fallback: "ORD-1010", label: "Invoice number unavailable" },
    { source: "legacy", lifecycle: "issued", id: "legacy-missing", fallback: "Invoice legacy-missing", label: "Invoice number unavailable" },
    { source: "v2", lifecycle: "draft", id: "live-draft", fallback: "ORD-1010", label: "Order ORD-1010" },
  ] as const) {
    const item = { ...invoicePage.items[0]!, source: example.source, lifecycle: example.lifecycle, recordId: example.id, invoiceId: example.id,
      invoiceNumber: example.fallback, persistedInvoiceNumber: null };
    const view = await mount({ invoiceId: "" }, { ...invoicePage, items: [item] });
    try {
      assert.equal(view.reads[0]?.invoiceId, example.id);
      await view.resolve(0, { ...originalInvoice, persistedInvoiceNumber: null,
        invoice: { ...originalInvoice.invoice, source: example.source, lifecycle: example.lifecycle, invoiceId: example.id, invoiceNumber: example.fallback } });
      assert.equal(view.container.querySelector(".v2-finance-detail h2")?.textContent, example.label);
      assert.equal(view.container.querySelector(".v2-finance-grid tbody tr button")?.textContent, example.label);
      assert.match(view.container.textContent!, /Source Order ORD-1010/);
      assert.doesNotMatch(view.container.textContent!, /Invoice ORD-1010|Invoice legacy-missing|native-missing/);
    } finally { await view.close(); }
  }
  console.log("PASS mounted Invoice safe empty, initial denied, raw native/legacy number absence, and live-draft Order display");
} finally {
  Object.assign(financeApi, originalApi);
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
}
