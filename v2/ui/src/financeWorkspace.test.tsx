import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { financeApi, invoiceApi, type FinancialInvoicePage, type FinancialInvoiceRead } from "./api";
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
assert.match(workspaceSource, /emailAdmissionError && <p className="notice error" role="alert">/, "email admission failures remain visible in the dialog");
assert.match(workspaceSource, /<p role="status">\{emailAdmission\.queuedInvoices\}/, "email admission success reports queued work in the dialog");
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
const previousGlobals = new Map(["window", "document", "localStorage", "crypto", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalApi = { ...financeApi }, originalInvoiceApi = { ...invoiceApi };
const businessRequestIds: string[] = [], financialCalls: string[] = [];
let stripeCreations = 0, networkCalls = 0;
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
  localStorage: { configurable: true, value: dom.window.localStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  crypto: { configurable: true, value: { randomUUID: () => { const id = `email-request-${businessRequestIds.length + 1}`; businessRequestIds.push(id); return id; } } },
  fetch: { configurable: true, value: async () => { networkCalls++; throw new Error("Unexpected network call in mounted Finance test."); } },
});
Object.defineProperty(dom.window, "Stripe", { value: () => { stripeCreations++; throw new Error("Email must not create a Stripe SDK instance."); } });
for (const operation of ["recordPayment", "recordRefund", "beginStripePayment", "beginStripeRefund"] as const) {
  financeApi[operation] = async () => { financialCalls.push(operation); throw new Error(`Unexpected financial mutation: ${operation}`); };
}
invoiceApi.issue = async () => { financialCalls.push("issue"); throw new Error("Unexpected Invoice issue mutation."); };
type EmailPreview = Awaited<ReturnType<typeof invoiceApi.emailPreview>>;
type EmailAdmission = Awaited<ReturnType<typeof invoiceApi.emailSelected>>;
const previewResult = (selected = 1, recipientCount = 1): EmailPreview => ({ selected, deliverableInvoices: selected, recipientCount, skipped: 0 });
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const mount = async (overrides: Partial<WorkspaceProps> = {}, page = invoicePage) => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const reads: { organizationId: string; invoiceId: string; result: ReturnType<typeof deferred<FinancialInvoiceRead>> }[] = [];
  const previews: { organizationId: string; invoiceIds: readonly string[]; result: ReturnType<typeof deferred<EmailPreview>> }[] = [];
  const admissions: { organizationId: string; requestId: string; invoiceIds: readonly string[]; result: ReturnType<typeof deferred<EmailAdmission>> }[] = [];
  const selections: string[] = [], orders: string[] = [];
  let backCount = 0, overviewCount = 0;
  financeApi.overview = async () => { overviewCount++; return page; };
  financeApi.invoice = async (organizationId, invoiceId) => {
    const result = deferred<FinancialInvoiceRead>(); reads.push({ organizationId, invoiceId, result }); return result.promise;
  };
  financeApi.legacyInvoice = financeApi.invoice;
  invoiceApi.emailPreview = async (organizationId, invoiceIds) => {
    const result = deferred<EmailPreview>(); previews.push({ organizationId, invoiceIds, result }); return result.promise;
  };
  invoiceApi.emailSelected = async (organizationId, requestId, invoiceIds) => {
    const result = deferred<EmailAdmission>(); admissions.push({ organizationId, requestId, invoiceIds, result }); return result.promise;
  };
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
    container, client, reads, previews, admissions, selections, orders, button,
    get backCount() { return backCount; }, get overviewCount() { return overviewCount; },
    click: async (label: string) => { await act(async () => button(label).click()); await flush(); },
    update: async (next: Partial<WorkspaceProps>) => { props = { ...props, ...next }; await act(async () => render()); await flush(); },
    resolve: async (index: number, value: FinancialInvoiceRead) => { await act(async () => reads[index]!.result.resolve(value)); await flush(); },
    reject: async (index: number, code = "NOT_FOUND", message = "Invoice financial history was not found.") => {
      await act(async () => reads[index]!.result.reject({ code, status: code === "FORBIDDEN" ? 403 : 404, message })); await flush();
    },
    toggleInvoice: async (index: number) => {
      const checkbox = container.querySelectorAll<HTMLInputElement>('input[aria-label="Select invoice"]')[index];
      assert.ok(checkbox, `Missing selectable Invoice ${index}`);
      await act(async () => checkbox.click()); await flush();
    },
    resolvePreview: async (index: number, value = previewResult()) => { await act(async () => previews[index]!.result.resolve(value)); await flush(); },
    rejectPreview: async (index: number) => { await act(async () => previews[index]!.result.reject(new Error("Recipient service unavailable."))); await flush(); },
    resolveAdmission: async (index: number) => {
      const selected = admissions[index]!.invoiceIds.length;
      await act(async () => admissions[index]!.result.resolve({ batchId: "batch-a", selected, queuedInvoices: selected, queuedMessages: 1, skipped: 0, replayed: false })); await flush();
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

  const assertEmailIsolation = (view: Awaited<ReturnType<typeof mount>>) => {
    const dialogs = [...view.container.querySelectorAll('[role="dialog"]')];
    assert.equal(dialogs.length, 1, "Email with loaded Invoice detail must render exactly one dialog");
    assert.equal(dialogs[0]!.getAttribute("aria-label"), "Send selected invoices");
    assert.equal(dialogs[0]!.querySelector("input, select, form, iframe"), null);
    assert.deepEqual([...view.container.querySelectorAll("button")].map((button) => button.textContent)
      .filter((label) => /^(Take Payment|Pay by Card|Record Refund|Refund to Card|Record Payment|Submit Stripe Refund|Continue to card|Confirm card payment|Issue Invoice)$/.test(label!)),
    [], "The email path exposes no financial controls, including behind the modal");
    assert.deepEqual(financialCalls, []);
    assert.equal(stripeCreations, 0);
    assert.equal(document.querySelector('script[src*="stripe"]'), null);
    assert.equal(networkCalls, 0);
  };
  const email = await mount({ canInvoiceSend: true });
  try {
    const withPayment: FinancialInvoiceRead = { ...originalInvoice,
      settlement: { ...originalInvoice.settlement, paid: money(200), balance: money(400) },
      history: [{ kind: "payment", id: "stripe-payment-a", amount: money(200), method: "card", source: "provider",
        occurredAt: "2026-08-27T00:00:00.000Z", recordedAt: "2026-08-27T00:00:00.000Z", balanceAfter: money(400) }] };
    const unchangedFacts = JSON.stringify(withPayment);
    await email.resolve(0, withPayment);
    for (const label of ["Take Payment", "Pay by Card", "Record Refund", "Refund to Card"]) email.button(label);
    await email.toggleInvoice(0); await email.toggleInvoice(1);
    const before = businessRequestIds.length;
    await email.click("Send selected");
    const requestId = businessRequestIds.at(-1)!;
    assert.equal(businessRequestIds.length, before + 1);
    assertEmailIsolation(email);
    assert.deepEqual(email.previews[0]!.invoiceIds, ["invoice-original", "invoice-replacement"]);
    assert.equal(email.button("Queue email delivery").disabled, true);
    await email.click("Queue email delivery");
    assert.equal(email.admissions.length, 0);
    await email.rejectPreview(0);
    assertEmailIsolation(email);
    assert.match(email.container.querySelector('[role="dialog"] [role="alert"]')!.textContent!, /Recipient service unavailable/);
    assert.equal(email.button("Queue email delivery").disabled, true);
    assert.equal(email.previews.length, 1, "Failed preview must not retry automatically");
    await email.click("Clear selection");
    await email.toggleInvoice(1);
    await email.click("Retry recipient preview (read only)");
    assert.equal(email.previews.length, 2);
    assert.equal(email.previews[1]!.organizationId, "org-a");
    assert.strictEqual(email.previews[1]!.invoiceIds, email.previews[0]!.invoiceIds, "Read retry retains the captured set, not the changed grid selection");
    assert.equal(businessRequestIds.length, before + 1, "Read retry cannot create a business request identity");
    assert.equal(email.admissions.length, 0, "Read retry cannot invoke the batch admission POST");
    assertEmailIsolation(email);
    await email.resolvePreview(1, previewResult(2));
    assert.equal(email.admissions.length, 0, "Preview success must not automatically queue email");
    assert.equal(email.button("Queue email delivery").disabled, false);
    await email.update({ csrfReady: false });
    assert.equal(email.button("Queue email delivery").disabled, true);
    await email.click("Queue email delivery");
    assert.equal(email.admissions.length, 0);
    await email.update({ csrfReady: true });
    await email.click("Queue email delivery");
    assert.equal(email.admissions.length, 1);
    assert.equal(email.admissions[0]!.requestId, requestId, "Admission uses the identity created before the failed read");
    assert.equal(email.admissions[0]!.organizationId, "org-a");
    assert.strictEqual(email.admissions[0]!.invoiceIds, email.previews[0]!.invoiceIds);
    assert.equal(email.button("Queuing…").disabled, true);
    assert.equal(email.button("Close").disabled, true);
    await email.click("Queuing…");
    assert.equal(email.admissions.length, 1);
    await email.resolveAdmission(0);
    assert.match(email.container.querySelector('[role="dialog"] [role="status"]')!.textContent!, /2 invoices queued in 1 customer email/);
    assert.equal(businessRequestIds.length, before + 1);
    assertEmailIsolation(email);
    assert.equal(JSON.stringify(withPayment), unchangedFacts, "Email operations do not change issued financial evidence");
    await email.click("Close");
    assert.equal(email.container.querySelector('[role="dialog"]'), null);
    for (const label of ["Take Payment", "Pay by Card", "Record Refund", "Refund to Card"]) email.button(label);
    console.log("PASS mounted email-only dialog, failed preview read retry, captured selection/request identity, explicit admission and no financial/Stripe effects");
  } finally { await email.close(); }

  const stale = await mount({ canInvoiceSend: true });
  try {
    await stale.resolve(0, originalInvoice);
    await stale.toggleInvoice(0); await stale.click("Send selected");
    await stale.resolvePreview(0, previewResult(1, 17));
    assert.equal(stale.button("Queue email delivery").disabled, false);
    await stale.click("Close"); await stale.click("Clear selection");
    await stale.toggleInvoice(1); await stale.click("Send selected");
    assertEmailIsolation(stale);
    assert.equal(stale.button("Queue email delivery").disabled, true, "A prior successful preview cannot authorize the new selection");
    assert.doesNotMatch(stale.container.querySelector('[role="dialog"]')!.textContent!, /17 recipients/);
    await stale.rejectPreview(1);
    assert.equal(stale.button("Queue email delivery").disabled, true);
    await stale.click("Queue email delivery"); assert.equal(stale.admissions.length, 0);
    await stale.click("Retry recipient preview (read only)");
    await stale.click("Close"); await stale.click("Clear selection");
    await stale.toggleInvoice(0); await stale.click("Send selected");
    await stale.rejectPreview(3);
    await stale.resolvePreview(2, previewResult(1, 23));
    assert.equal(stale.button("Queue email delivery").disabled, true, "A late success cannot replace the new selection's failed preview");
    assert.doesNotMatch(stale.container.querySelector('[role="dialog"]')!.textContent!, /23 recipients/);
    await stale.click("Queue email delivery"); assert.equal(stale.admissions.length, 0);
    assertEmailIsolation(stale);
    console.log("PASS mounted prior and late email preview successes cannot authorize another selection");
  } finally { await stale.close(); }

  for (const change of [
    { organizationId: "org-b" }, { sessionScope: "scope-b" }, { canInvoiceSend: false }, { canPaymentView: false },
  ] satisfies Partial<WorkspaceProps>[]) {
    const scoped = await mount({ canInvoiceSend: true });
    try {
      await scoped.resolve(0, originalInvoice);
      await scoped.toggleInvoice(0); await scoped.click("Send selected");
      const requestCount = businessRequestIds.length;
      await scoped.update(change);
      assert.equal(scoped.container.querySelector('[role="dialog"]'), null, "Context changes invalidate the email dialog immediately");
      await scoped.update({ organizationId: "org-a", sessionScope: "scope-a", canInvoiceSend: true, canPaymentView: true });
      assert.equal(scoped.container.querySelector('[role="dialog"]'), null, "Returning to the old scope cannot revive its email intent");
      assert.equal(businessRequestIds.length, requestCount);
      assert.equal(scoped.previews.length, 1, "Context changes never automatically retry preview");
      assert.ok([...scoped.container.querySelectorAll<HTMLInputElement>('input[aria-label="Select invoice"]')].every((input) => !input.checked));
      await scoped.toggleInvoice(1); await scoped.click("Send selected");
      await scoped.resolvePreview(0, previewResult(1, 31));
      assertEmailIsolation(scoped);
      assert.equal(scoped.button("Queue email delivery").disabled, true);
      assert.doesNotMatch(scoped.container.querySelector('[role="dialog"]')!.textContent!, /31 recipients/);
      await scoped.rejectPreview(1); await scoped.click("Retry recipient preview (read only)");
      assert.deepEqual(scoped.previews[2]!.invoiceIds, ["invoice-replacement"]);
      assert.equal(scoped.previews[2]!.organizationId, "org-a");
      assert.equal(businessRequestIds.length, requestCount + 1);
      assert.equal(scoped.admissions.length, 0);
      await scoped.resolvePreview(2);
      assert.equal(scoped.button("Queue email delivery").disabled, false);
      await scoped.update(change);
      await scoped.update({ organizationId: "org-a", sessionScope: "scope-a", canInvoiceSend: true, canPaymentView: true });
      assert.equal(scoped.container.querySelector('[role="dialog"]'), null, "A successful preview is also invalidated when scope or permission changes");
      assert.equal(scoped.previews.length, 3);
      assert.equal(scoped.admissions.length, 0);
    } finally { await scoped.close(); }
  }
  assert.deepEqual(financialCalls, []);
  assert.equal(stripeCreations, 0); assert.equal(networkCalls, 0);
  console.log("PASS mounted email tenant/session/permission invalidation, explicit scoped read retry, and zero financial/provider calls");
} finally {
  Object.assign(financeApi, originalApi);
  Object.assign(invoiceApi, originalInvoiceApi);
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
}
