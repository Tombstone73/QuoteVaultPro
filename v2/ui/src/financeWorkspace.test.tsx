import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { financeApi, invoiceApi, type FinancialInvoicePage, type FinancialInvoiceRead, type UiBootstrap } from "./api";
import { FinanceWorkspace, invoiceDocumentPath, submitStripeConfirmationIfAuthorized } from "./FinanceWorkspace";
import { persistFinanceRequestRecovery, readFinanceRequestRecovery, type FinanceRequestRecoveryIdentity, type FinanceRequestStorage } from "./financeRequestRecovery";
const { Simulate } = await import("react-dom/test-utils");

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
const sessionStorageFixture = (): FinanceRequestStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
};
const recoveryIdentity: FinanceRequestRecoveryIdentity = { organizationId: "org-storage", verifiedUserId: "actor-storage", sessionScope: "scope-one" };
const recoveryRequest = {
  kind: "payment" as const, organizationId: "org-storage", verifiedUserId: "actor-storage", submittedSessionScope: "scope-one",
  invoiceId: "invoice-storage", businessRequestId: "request-storage",
  input: { amountCents: 1234, currency: "USD", method: "cash" as const, occurredAt: "2026-10-02T11:00:00.000Z" },
};
const recoveryStorage = sessionStorageFixture();
assert.deepEqual(persistFinanceRequestRecovery(recoveryIdentity, recoveryRequest, recoveryStorage), { status: "stored", requests: [recoveryRequest] });
const storedRecoveryJson = [...recoveryStorage.values.values()][0]!;
assert.ok(storedRecoveryJson.includes("request-storage") && storedRecoveryJson.includes("2026-10-02T11:00:00.000Z"));
assert.doesNotMatch(storedRecoveryJson, /clientSecret|cardNumber|paymentMethodToken/u, "recovery stores request identity/body only, never provider secrets or card details");
assert.deepEqual(readFinanceRequestRecovery({ ...recoveryIdentity, sessionScope: "scope-after-reauth" }, recoveryStorage), { status: "stored", requests: [recoveryRequest] });
assert.deepEqual(readFinanceRequestRecovery({ ...recoveryIdentity, verifiedUserId: "other-actor", sessionScope: "scope-after-reauth" }, recoveryStorage), { status: "empty", requests: [] }, "different actors have disjoint sessionStorage keys");
const changedRecoveryRequest = { ...recoveryRequest, input: { ...recoveryRequest.input, amountCents: 1235 } };
assert.equal(persistFinanceRequestRecovery(recoveryIdentity, changedRecoveryRequest, recoveryStorage).status, "blocked", "same request ID cannot overwrite a frozen stored body");
assert.equal([...recoveryStorage.values.values()][0], storedRecoveryJson, "failed replacement leaves original storage intact");
const leakyRecoveryRequest = { ...recoveryRequest, clientSecret: "must-not-persist" };
assert.equal(persistFinanceRequestRecovery(recoveryIdentity, leakyRecoveryRequest, sessionStorageFixture()).status, "blocked", "unexpected secret-bearing fields fail closed");
const noActorIdentity = { organizationId: "org-storage", sessionScope: "scope-only" };
assert.equal(persistFinanceRequestRecovery(noActorIdentity, { ...recoveryRequest, verifiedUserId: undefined, submittedSessionScope: "scope-only" }, recoveryStorage).status, "stored");
assert.equal(readFinanceRequestRecovery({ ...noActorIdentity, sessionScope: "rotated-scope" }, recoveryStorage).status, "empty", "without a stable bootstrap actor, recovery remains epoch-scoped");
const refundSlotStorage = sessionStorageFixture();
const manualRefundSlot = { ...recoveryRequest, kind: "refund" as const, input: { paymentId: "payment-slot", amountCents: 300, currency: "USD", occurredAt: "2026-10-02T11:00:00.000Z" } };
assert.equal(persistFinanceRequestRecovery(recoveryIdentity, manualRefundSlot, refundSlotStorage).status, "stored");
const providerRefundSameSlot = { ...manualRefundSlot, kind: "stripeRefund" as const, input: { paymentId: "payment-slot", amountCents: 300, currency: "USD" }, submitted: false, businessRequestId: "provider-refund-slot" };
assert.equal(persistFinanceRequestRecovery(recoveryIdentity, providerRefundSameSlot, refundSlotStorage).status, "blocked", "manual and provider Refunds cannot replace the same unresolved original-Payment allocation");
const corruptStorage = sessionStorageFixture(); corruptStorage.setItem("printershero:v2:finance-request:v1:corrupt", "{");
assert.equal(readFinanceRequestRecovery(recoveryIdentity, { ...corruptStorage, getItem: () => "{" }).status, "blocked");
const unavailableStorage = { getItem: () => { throw new Error("storage denied"); }, setItem: () => { throw new Error("storage denied"); }, removeItem: () => { throw new Error("storage denied"); } };
assert.equal(persistFinanceRequestRecovery(recoveryIdentity, recoveryRequest, unavailableStorage).status, "unavailable");
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
dom.window.sessionStorage.clear();
const storedRequestById = (businessRequestId: string): Record<string, unknown> | undefined =>
  Array.from({ length: dom.window.sessionStorage.length }, (_, index) => dom.window.sessionStorage.getItem(dom.window.sessionStorage.key(index)!)!)
    .map((raw) => JSON.parse(raw) as { requests?: Record<string, unknown>[] })
    .flatMap((entry) => entry.requests ?? [])
    .find((request) => request.businessRequestId === businessRequestId);
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
const mount = async (overrides: Partial<WorkspaceProps> = {}, page = invoicePage, initialUserId = "staff-a") => {
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
  let verifiedUserId = initialUserId;
  const seedBootstrap = () => client.setQueryData<UiBootstrap>(["v2", props.sessionScope, props.organizationId, "ui-bootstrap"], {
    organizationId: props.organizationId, userId: verifiedUserId, sessionScope: props.sessionScope, csrfToken: `csrf-${props.sessionScope}`, capabilities: { quoteOverridePrice: false },
  } as UiBootstrap);
  seedBootstrap();
  const render = () => root.render(<QueryClientProvider client={client}><FinanceWorkspace {...props} /></QueryClientProvider>);
  await act(async () => render()); await flush();
  const button = (label: string) => {
    const found = [...container.querySelectorAll("button")].find((value) => value.textContent === label);
    assert.ok(found, `Missing button: ${label}`); return found;
  };
  const dialogButton = (label: string) => {
    const found = [...(container.querySelector('[role="dialog"]')?.querySelectorAll("button") ?? [])].find((value) => value.textContent === label);
    assert.ok(found, `Missing dialog button: ${label}`); return found;
  };
  return {
    container, client, reads, previews, admissions, selections, orders, button,
    get backCount() { return backCount; }, get overviewCount() { return overviewCount; },
    click: async (label: string) => { await act(async () => button(label).click()); await flush(); },
    clickDialog: async (label: string) => { await act(async () => dialogButton(label).click()); await flush(); },
    setInput: async (label: string, value: string) => {
      const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      assert.ok(field, `Missing input: ${label}`);
      await act(async () => { field.value = value; Simulate.change(field); }); await flush();
    },
    setSelect: async (label: string, value: string) => {
      const field = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
      assert.ok(field, `Missing select: ${label}`);
      await act(async () => { field.value = value; Simulate.change(field); }); await flush();
    },
    update: async (next: Partial<WorkspaceProps>, nextUserId = verifiedUserId) => { props = { ...props, ...next }; verifiedUserId = nextUserId; seedBootstrap(); await act(async () => render()); await flush(); },
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
  type ManualPaymentInput = Parameters<typeof financeApi.recordPayment>[3];
  type ManualRefundInput = Parameters<typeof financeApi.recordRefund>[3];
  const paymentCalls: { organizationId: string; invoiceId: string; requestId: string; input: ManualPaymentInput; result: ReturnType<typeof deferred<unknown>> }[] = [];
  financeApi.recordPayment = async (organizationId, invoiceId, requestId, input) => {
    const result = deferred<unknown>(); paymentCalls.push({ organizationId, invoiceId, requestId, input, result }); return result.promise;
  };
  const beforePaymentIdentity = businessRequestIds.length;
  const paymentView = await mount();
  let originalPaymentRequest: Omit<(typeof paymentCalls)[number], "result"> | undefined;
  try {
    await paymentView.resolve(0, originalInvoice);
    await paymentView.click("Take Payment");
    await paymentView.setInput("Amount", "3.25");
    await paymentView.setSelect("Payment method", "cash");
    await paymentView.click("Record Payment");
    assert.equal(paymentCalls.length, 1);
    const first = paymentCalls[0]!;
    assert.equal(first.organizationId, "org-a"); assert.equal(first.invoiceId, "invoice-original");
    assert.equal(first.requestId, businessRequestIds.at(-1));
    assert.deepEqual({ ...first.input, occurredAt: undefined }, { amountCents: 325, currency: "USD", method: "cash", occurredAt: undefined });
    assert.ok(Number.isFinite(Date.parse(first.input.occurredAt)));
    const storedPayment = storedRequestById(first.requestId);
    assert.equal((storedPayment?.input as { occurredAt?: string } | undefined)?.occurredAt, first.input.occurredAt, "identity, tender, amount, currency and occurredAt are in sessionStorage before the stubbed POST");
    assert.equal(businessRequestIds.length, beforePaymentIdentity + 1);
    assert.equal(paymentView.container.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!.disabled, true);
    first.result.reject({ code: "NETWORK", message: "Connection reset after submission." }); await flush();
    assert.equal(paymentCalls.length, 1, "an unknown result cannot auto-submit a replacement Payment");
    assert.match(paymentView.container.querySelector('[role="status"]')!.textContent!, /exact submitted identity/u);
    originalPaymentRequest = { organizationId: first.organizationId, invoiceId: first.invoiceId, requestId: first.requestId, input: first.input };
  } finally { await paymentView.close(); }
  const paymentRecoveryView = await mount({ sessionScope: "scope-b", csrfReady: false });
  try {
    await paymentRecoveryView.resolve(0, originalInvoice);
    assert.equal(paymentCalls.length, 1, "sessionStorage recovery after a fresh Finance mount does not submit automatically");
    assert.equal(paymentRecoveryView.button("Resume original Payment").disabled, true, "same-actor replay waits for the new CSRF context");
    await paymentRecoveryView.update({ csrfReady: true });
    await paymentRecoveryView.click("Resume original Payment");
    assert.equal(paymentRecoveryView.container.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!.value, "3.25");
    assert.equal(paymentRecoveryView.container.querySelector<HTMLSelectElement>('select[aria-label="Payment method"]')!.value, "cash");
    await paymentRecoveryView.click("Retry original Payment");
    assert.equal(paymentCalls.length, 2);
    assert.deepEqual({ organizationId: paymentCalls[1]!.organizationId, invoiceId: paymentCalls[1]!.invoiceId, requestId: paymentCalls[1]!.requestId, input: paymentCalls[1]!.input }, originalPaymentRequest);
    assert.equal(businessRequestIds.length, beforePaymentIdentity + 1, "reload recovery must not mint another request identity");
    paymentCalls[1]!.result.resolve({ accepted: true }); await flush();
    assert.match(paymentRecoveryView.container.textContent!, /Payment recorded as an immutable financial fact/u);
  } finally { await paymentRecoveryView.close(); }
  const actorIsolationView = await mount({}, invoicePage, "verified-actor-a");
  try {
    await actorIsolationView.resolve(0, originalInvoice);
    await actorIsolationView.click("Take Payment");
    await actorIsolationView.setInput("Amount", "3.25");
    await actorIsolationView.click("Record Payment");
    const unknownForActorA = paymentCalls[2]!;
    unknownForActorA.result.reject({ code: "NETWORK", message: "Actor A request outcome is unknown." }); await flush();
    await actorIsolationView.update({ sessionScope: "actor-b-epoch" }, "verified-actor-b");
    await actorIsolationView.resolve(1, originalInvoice);
    assert.doesNotMatch(actorIsolationView.container.textContent!, /Resume original Payment|3\.25|Actor A request/u);
    assert.ok(actorIsolationView.button("Take Payment"), "a different verified actor receives no prior request body or recovery controls");
    assert.equal(businessRequestIds.length, beforePaymentIdentity + 2, "actor change does not replay or regenerate the prior actor's identity");
    await actorIsolationView.click("Take Payment");
    assert.equal(actorIsolationView.container.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!.value, "6.00", "a different actor sees a fresh form, not the prior submitted amount");
  } finally { await actorIsolationView.close(); }
  financeApi.recordPayment = originalApi.recordPayment;

  const refundCalls: { organizationId: string; invoiceId: string; requestId: string; input: ManualRefundInput; result: ReturnType<typeof deferred<unknown>> }[] = [];
  financeApi.recordRefund = async (organizationId, invoiceId, requestId, input) => {
    const result = deferred<unknown>(); refundCalls.push({ organizationId, invoiceId, requestId, input, result }); return result.promise;
  };
  const withPayment: FinancialInvoiceRead = {
    ...originalInvoice, settlement: { ...originalInvoice.settlement, paid: money(600), balance: money(0) },
    history: [{ kind: "payment", id: "payment-original", amount: money(600), method: "check", source: "manual", occurredAt: "2026-10-01T12:00:00.000Z", recordedAt: "2026-10-01T12:00:00.000Z", balanceAfter: money(0) }],
  };
  const beforeRefundIdentity = businessRequestIds.length;
  const refundView = await mount();
  try {
    await refundView.resolve(0, withPayment);
    await refundView.click("Record Refund");
    await refundView.setSelect("Original Payment", "payment-original");
    await refundView.setInput("Amount", "2.50");
    await refundView.clickDialog("Record Refund");
    const first = refundCalls[0]!;
    assert.equal(refundCalls.length, 1); assert.equal(first.requestId, businessRequestIds.at(-1));
    assert.deepEqual({ ...first.input, occurredAt: undefined }, { paymentId: "payment-original", amountCents: 250, currency: "USD", occurredAt: undefined });
    assert.ok(Number.isFinite(Date.parse(first.input.occurredAt)));
    assert.deepEqual(storedRequestById(first.requestId)?.input, first.input, "the exact Refund allocation and occurrence time are persisted before POST");
    first.result.reject({ code: "NETWORK", message: "Refund response was lost." }); await flush();
    assert.equal(refundCalls.length, 1, "an unknown Refund outcome cannot auto-submit again");
    assert.equal(refundView.container.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!.disabled, true);
    await refundView.clickDialog("Retry original Refund");
    assert.equal(refundCalls.length, 2);
    assert.deepEqual({ ...refundCalls[1]!, result: undefined }, { ...first, result: undefined }, "Refund retry preserves Payment allocation and occurredAt");
    assert.equal(businessRequestIds.length, beforeRefundIdentity + 1);
    refundCalls[1]!.result.resolve({ accepted: true }); await flush();
    assert.match(refundView.container.textContent!, /Refund recorded as a separate immutable financial fact/u);
  } finally { await refundView.close(); }
  financeApi.recordRefund = originalApi.recordRefund;

  type StripeRefundResult = Awaited<ReturnType<typeof financeApi.beginStripeRefund>>;
  const stripeRefundCalls: { organizationId: string; invoiceId: string; requestId: string; input: Parameters<typeof financeApi.beginStripeRefund>[3]; result: ReturnType<typeof deferred<StripeRefundResult>> }[] = [];
  financeApi.beginStripeRefund = async (organizationId, invoiceId, requestId, input) => {
    const result = deferred<StripeRefundResult>(); stripeRefundCalls.push({ organizationId, invoiceId, requestId, input, result }); return result.promise;
  };
  const providerInvoice: FinancialInvoiceRead = {
    ...withPayment,
    history: [{ kind: "payment", id: "provider-payment-a", amount: money(600), method: "card", source: "provider", occurredAt: "2026-10-01T12:00:00.000Z", recordedAt: "2026-10-01T12:00:00.000Z", balanceAfter: money(0) }],
  };
  const beforeStripeRefundIdentity = businessRequestIds.length;
  const stripeRefundView = await mount({ organizationId: "org-refund", sessionScope: "scope-refund", invoiceId: "invoice-original" }, invoicePage, "verified-refund-actor");
  try {
    await stripeRefundView.resolve(0, providerInvoice);
    await stripeRefundView.click("Refund to Card");
    await stripeRefundView.setSelect("Original Payment", "provider-payment-a");
    await stripeRefundView.setInput("Amount", "2.50");
    await stripeRefundView.clickDialog("Submit Stripe Refund");
    const first = stripeRefundCalls[0]!;
    assert.equal(stripeRefundCalls.length, 1);
    assert.deepEqual(first.input, { paymentId: "provider-payment-a", amountCents: 250, currency: "USD" });
    assert.equal(first.requestId, businessRequestIds.at(-1));
    assert.deepEqual(storedRequestById(first.requestId)?.input, first.input, "the original provider Refund target and amount are persisted before POST");
    first.result.reject({ code: "NETWORK", message: "Stripe Refund response was lost." }); await flush();
    assert.equal(stripeRefundCalls.length, 1, "an unknown Stripe Refund result cannot mint a replacement ID");
  } finally { await stripeRefundView.close(); }
  const stripeRefundRecoveryView = await mount({ organizationId: "org-refund", sessionScope: "scope-refund-next", invoiceId: "invoice-original" }, invoicePage, "verified-refund-actor");
  try {
    await stripeRefundRecoveryView.resolve(0, providerInvoice);
    assert.equal(stripeRefundCalls.length, 1, "reloaded Stripe Refund recovery is not automatically submitted");
    await stripeRefundRecoveryView.click("Resume original Stripe Refund");
    assert.equal(stripeRefundRecoveryView.container.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!.value, "2.50");
    assert.equal(stripeRefundRecoveryView.container.querySelector<HTMLSelectElement>('select[aria-label="Original Payment"]')!.value, "provider-payment-a");
    await stripeRefundRecoveryView.clickDialog("Retry original Stripe Refund");
    assert.equal(stripeRefundCalls.length, 2);
    assert.equal(stripeRefundCalls[1]!.requestId, stripeRefundCalls[0]!.requestId);
    assert.deepEqual(stripeRefundCalls[1]!.input, stripeRefundCalls[0]!.input);
    assert.equal(businessRequestIds.length, beforeStripeRefundIdentity + 1);
    stripeRefundCalls[1]!.result.resolve({ providerOperationId: "refund-op-a", refundId: "refund-a" }); await flush();
    assert.match(stripeRefundRecoveryView.container.textContent!, /Refund submitted to Stripe/u);
  } finally { await stripeRefundRecoveryView.close(); }
  const confirmedStripeRefundView = await mount({ organizationId: "org-refund", sessionScope: "scope-refund-confirmed", invoiceId: "invoice-original" }, invoicePage, "verified-refund-actor");
  try {
    await confirmedStripeRefundView.resolve(0, providerInvoice);
    assert.equal(stripeRefundCalls.length, 2, "confirmed Refund recovery remains explicit after reload");
    await confirmedStripeRefundView.click("Resume original Stripe Refund");
    await confirmedStripeRefundView.clickDialog("Retry original Stripe Refund");
    assert.equal(stripeRefundCalls.length, 3);
    assert.equal(stripeRefundCalls[2]!.requestId, stripeRefundCalls[0]!.requestId);
    stripeRefundCalls[2]!.result.resolve({ providerOperationId: "refund-op-a", refundId: "refund-a", confirmed: true } as StripeRefundResult);
    await flush();
    assert.equal(storedRequestById(stripeRefundCalls[0]!.requestId), undefined, "signed provider success clears only the completed Refund slot");
    assert.ok(confirmedStripeRefundView.button("Refund to Card"), "canonical confirmation releases the same-actor Refund slot for remaining refundable balance");
  } finally { await confirmedStripeRefundView.close(); }
  financeApi.beginStripeRefund = originalApi.beginStripeRefund;

  type StripePaymentResult = Awaited<ReturnType<typeof financeApi.beginStripePayment>>;
  const stripeCalls: { organizationId: string; invoiceId: string; requestId: string; input: Parameters<typeof financeApi.beginStripePayment>[3]; result: ReturnType<typeof deferred<StripePaymentResult>> }[] = [];
  financeApi.beginStripePayment = async (organizationId, invoiceId, requestId, input) => {
    const result = deferred<StripePaymentResult>(); stripeCalls.push({ organizationId, invoiceId, requestId, input, result }); return result.promise;
  };
  const beforeStripeIdentity = businessRequestIds.length;
  const stripeView = await mount();
  try {
    await stripeView.resolve(0, originalInvoice);
    await stripeView.click("Pay by Card");
    await stripeView.setInput("Amount", "4.75");
    await stripeView.click("Continue to card");
    assert.equal(stripeCalls.length, 1);
    const submitted = stripeCalls[0]!;
    assert.equal(submitted.organizationId, "org-a"); assert.equal(submitted.invoiceId, "invoice-original");
    assert.deepEqual(submitted.input, { amountCents: 475, currency: "USD" });
    assert.equal(submitted.requestId, businessRequestIds.at(-1));
    assert.equal(businessRequestIds.length, beforeStripeIdentity + 1);
    const storedIntent = storedRequestById(submitted.requestId);
    assert.deepEqual(storedIntent?.input, submitted.input, "Stripe request body is persisted and round-tripped before POST");
    assert.doesNotMatch(JSON.stringify(storedIntent), /clientSecret|pi_secret|cardNumber|paymentMethodToken/u);
    await stripeView.update({ sessionScope: "scope-b" });
    await stripeView.resolve(1, originalInvoice);
    submitted.result.resolve({ providerOperationId: "operation-old", paymentIntentId: "intent-old", clientSecret: "pi_secret_old", publishableKey: "pk_test_stub", stripeAccountId: "acct-old", amountCents: 475, currency: "USD" });
    await flush();
    assert.equal(stripeView.container.querySelector('[role="dialog"]'), null, "late Stripe response cannot revive the prior session");
    assert.doesNotMatch(stripeView.container.textContent!, /Enter card details|pi_secret_old|intent-old|operation-old/);
    assert.ok(stripeView.button("Resume original card intent"), "the same verified actor retains the original intent across session epochs");
    assert.equal(stripeCalls.length, 1, "same-actor session recovery never automatically replays the begin request");
    await stripeView.click("Resume original card intent");
    assert.ok(stripeView.button("Retry original card intent"));
    await stripeView.click("Retry original card intent");
    assert.equal(stripeCalls.length, 2);
    assert.equal(stripeCalls[1]!.requestId, submitted.requestId);
    assert.deepEqual(stripeCalls[1]!.input, submitted.input);
    assert.equal(businessRequestIds.length, beforeStripeIdentity + 1, "same-actor Stripe replay preserves its original request ID and body");
    stripeCalls[1]!.result.resolve({ providerOperationId: "operation-new-epoch", paymentIntentId: "intent-new-epoch", clientSecret: "pi_secret_new_epoch", publishableKey: "pk_test_stub", stripeAccountId: "acct-new", amountCents: 475, currency: "USD" });
    await flush();
    assert.ok(stripeView.button("Enter card details"), "a response fetched by explicit authorized replay is available only in the current epoch");
    assert.doesNotMatch(stripeView.container.textContent!, /pi_secret_new_epoch/);
    assert.ok(!Array.from({ length: dom.window.sessionStorage.length }, (_, index) => dom.window.sessionStorage.getItem(dom.window.sessionStorage.key(index)!)!).some((raw) => raw.includes("pi_secret_new_epoch")), "client secrets remain ephemeral and never enter sessionStorage");
    await stripeView.update({ sessionScope: "actor-b-epoch" }, "verified-actor-b");
    await stripeView.resolve(2, originalInvoice);
    assert.doesNotMatch(stripeView.container.textContent!, /Resume original card intent|Enter card details|intent-new-epoch|pi_secret_new_epoch/);
    assert.ok(stripeView.button("Pay by Card"), "a different actor cannot see the original request or its secret");
    assert.equal(stripeCalls.length, 2, "actor change does not replay another actor's provider intent");
    assert.equal(stripeCreations, 0, "mounted tests never instantiate Stripe.js or Elements");
    assert.equal(networkCalls, 0, "mounted tests use in-memory API stubs only");
  } finally { await stripeView.close(); }
  const previousStripeBegin = financeApi.beginStripePayment;
  const multiInvoiceCalls: typeof stripeCalls = [];
  financeApi.beginStripePayment = async (organizationId, invoiceId, requestId, input) => {
    const result = deferred<StripePaymentResult>(); multiInvoiceCalls.push({ organizationId, invoiceId, requestId, input, result }); return result.promise;
  };
  const multiInvoiceView = await mount({ organizationId: "org-multi-intent", sessionScope: "scope-multi-intent", invoiceId: "invoice-original" }, invoicePage, "verified-multi-actor");
  try {
    await multiInvoiceView.resolve(0, originalInvoice);
    await multiInvoiceView.click("Pay by Card");
    await multiInvoiceView.setInput("Amount", "4.00");
    await multiInvoiceView.click("Continue to card");
    multiInvoiceCalls[0]!.result.reject({ code: "NETWORK", message: "Invoice A intent outcome is unknown." }); await flush();
    const idsBeforeInvoiceB = businessRequestIds.length;
    await multiInvoiceView.update({ invoiceId: "invoice-replacement" });
    await multiInvoiceView.resolve(1, replacementInvoice);
    assert.equal(multiInvoiceCalls.length, 1, "changing Invoice does not automatically replay the pending intent");
    assert.equal(multiInvoiceView.button("Pay by Card").disabled, false, "an unresolved operation is scoped to its affected Invoice, not a global one-intent lock");
    await multiInvoiceView.click("Pay by Card");
    await multiInvoiceView.setInput("Amount", "2.00");
    await multiInvoiceView.click("Continue to card");
    assert.equal(multiInvoiceCalls.length, 2);
    assert.equal(multiInvoiceCalls[0]!.invoiceId, "invoice-original");
    assert.equal(multiInvoiceCalls[1]!.invoiceId, "invoice-replacement");
    assert.notEqual(multiInvoiceCalls[0]!.requestId, multiInvoiceCalls[1]!.requestId);
    assert.equal(businessRequestIds.length, idsBeforeInvoiceB + 1, "the second ID is created only for the distinct Invoice operation");
    assert.equal(stripeCreations, 0);
    assert.equal(networkCalls, 0);
  } finally { await multiInvoiceView.close(); }
  financeApi.beginStripePayment = previousStripeBegin;
  const beforeMalformedIdentity = businessRequestIds.length;
  const malformedStripeView = await mount({ organizationId: "org-c", sessionScope: "scope-c", invoiceId: "invoice-replacement" });
  try {
    await malformedStripeView.resolve(0, replacementInvoice);
    await malformedStripeView.click("Pay by Card");
    await malformedStripeView.setInput("Amount", "4.75");
    await malformedStripeView.click("Continue to card");
    const mismatchIndex = stripeCalls.length - 1;
    const mismatched = stripeCalls[mismatchIndex]!;
    mismatched.result.resolve({ providerOperationId: "operation-c", paymentIntentId: "intent-c", clientSecret: "pi_secret_mismatched", publishableKey: "pk_test_stub", stripeAccountId: "acct-c", amountCents: 475, currency: "CAD" });
    await flush();
    assert.equal(businessRequestIds.length, beforeMalformedIdentity + 1);
    assert.doesNotMatch(malformedStripeView.container.textContent!, /Enter card details|pi_secret_mismatched/);
    assert.ok(malformedStripeView.button("Retry original card intent"), "mismatched response keeps the original intent for explicit retry");
    await malformedStripeView.click("Retry original card intent");
    assert.equal(stripeCalls.length, mismatchIndex + 2);
    assert.equal(stripeCalls[mismatchIndex + 1]!.requestId, mismatched.requestId);
    assert.deepEqual(stripeCalls[mismatchIndex + 1]!.input, mismatched.input);
    assert.equal(businessRequestIds.length, beforeMalformedIdentity + 1, "Stripe response mismatch cannot mint a replacement intent");
    stripeCalls[mismatchIndex + 1]!.result.reject({ code: "NETWORK", message: "Original card intent still has unknown outcome." }); await flush();
    assert.equal(stripeCalls.length, mismatchIndex + 2, "Stripe retry remains explicit with automatic mutation retries disabled");
  } finally { await malformedStripeView.close(); }

  const revokedCalls: typeof stripeCalls = [];
  financeApi.beginStripePayment = async (organizationId, invoiceId, requestId, input) => {
    const result = deferred<StripePaymentResult>(); revokedCalls.push({ organizationId, invoiceId, requestId, input, result }); return result.promise;
  };
  const revokedView = await mount({ organizationId: "org-d", sessionScope: "scope-d", invoiceId: "invoice-original" }, invoicePage, "verified-actor-d");
  try {
    await revokedView.resolve(0, originalInvoice);
    await revokedView.click("Pay by Card");
    await revokedView.setInput("Amount", "5.25");
    await revokedView.click("Continue to card");
    const first = revokedCalls[0]!;
    const beforeRevokeIdCount = businessRequestIds.length;
    await revokedView.update({ canPaymentRecord: false });
    await revokedView.update({ canPaymentRecord: true });
    first.result.resolve({ providerOperationId: "operation-revoked", paymentIntentId: "intent-revoked", clientSecret: "pi_secret_revoked", publishableKey: "pk_test_stub", stripeAccountId: "acct-d", amountCents: 525, currency: "USD" });
    await flush();
    assert.doesNotMatch(revokedView.container.textContent!, /Enter card details|pi_secret_revoked/, "a begin response from the revoked grant epoch is never adopted after regrant");
    assert.ok(revokedView.button("Resume original card intent"));
    await revokedView.click("Resume original card intent");
    await revokedView.click("Retry original card intent");
    assert.equal(revokedCalls.length, 2);
    assert.equal(revokedCalls[1]!.requestId, first.requestId);
    assert.deepEqual(revokedCalls[1]!.input, first.input);
    revokedCalls[1]!.result.resolve({ providerOperationId: "operation-adopted", paymentIntentId: "intent-adopted", clientSecret: "pi_secret_adopted", publishableKey: "pk_test_stub", stripeAccountId: "acct-d", amountCents: 525, currency: "USD" });
    await flush();
    assert.ok(revokedView.button("Enter card details"), "an explicit same-ID begin under restored authority can adopt the result");
    await revokedView.update({ canPaymentRecord: false });
    assert.equal(revokedView.container.querySelector('[role="dialog"]'), null, "grant loss closes the active card dialog");
    assert.doesNotMatch(revokedView.container.textContent!, /Enter card details|pi_secret_adopted|Confirm card payment/);
    assert.equal(stripeCreations, 0, "permission-revocation tests never load Stripe.js or Elements");
    await revokedView.update({ canPaymentRecord: true });
    assert.doesNotMatch(revokedView.container.textContent!, /Enter card details|pi_secret_adopted/ , "grant restoration does not resurrect the stale client secret");
    assert.ok(revokedView.button("Resume original card intent"));
    await revokedView.click("Resume original card intent");
    assert.ok(revokedView.button("Retry original card intent"));
    assert.equal(revokedCalls.length, 2, "grant restoration requires an explicit same-ID replay");
    await revokedView.click("Retry original card intent");
    assert.equal(revokedCalls.length, 3);
    assert.equal(revokedCalls[2]!.requestId, first.requestId);
    assert.deepEqual(revokedCalls[2]!.input, first.input);
    assert.equal(businessRequestIds.length, beforeRevokeIdCount, "permission revalidation does not mint another intent identity");
    revokedCalls[2]!.result.resolve({ providerOperationId: "operation-revalidated", paymentIntentId: "intent-revalidated", clientSecret: "pi_secret_revalidated", publishableKey: "pk_test_stub", stripeAccountId: "acct-d", amountCents: 525, currency: "USD" });
    await flush();
    assert.ok(revokedView.button("Enter card details"), "a newly initiated same-ID response is adopted only after current permission is restored");
    assert.doesNotMatch(revokedView.container.textContent!, /pi_secret_revalidated/);
    assert.equal(stripeCreations, 0);
    assert.equal(networkCalls, 0);
  } finally { await revokedView.close(); }

  const confirmResult = deferred<Readonly<{ error?: Readonly<{ message?: string }> | null }>>();
  let currentAuthority = true, currentAuthorityEpoch = "scope-d", confirmationCalls = 0, submittedConfirmations = 0;
  const confirmation = submitStripeConfirmationIfAuthorized(
    () => { confirmationCalls++; return confirmResult.promise; },
    () => currentAuthority && currentAuthorityEpoch === "scope-d",
    () => { submittedConfirmations++; },
    () => assert.fail("permission revoked while confirmation was pending must not publish a completion callback"),
  );
  assert.equal(confirmationCalls, 1, "the fake confirmation port is called only while the grant is current");
  currentAuthority = false;
  currentAuthorityEpoch = "scope-replaced";
  confirmResult.resolve({});
  assert.equal(await confirmation, false);
  assert.equal(submittedConfirmations, 0, "a pending confirm result after grant revocation or scope replacement cannot transition Finance state");
  assert.equal(await submitStripeConfirmationIfAuthorized(
    async () => { confirmationCalls++; return {}; }, () => false, () => { submittedConfirmations++; }, () => {},
  ), false);
  assert.equal(confirmationCalls, 1, "no Stripe confirm call is made when payment.record is already revoked");
  financeApi.beginStripePayment = originalApi.beginStripePayment;
  const sessionStorageProperty = Object.getOwnPropertyDescriptor(dom.window, "sessionStorage");
  Object.defineProperty(dom.window, "sessionStorage", { configurable: true, get: () => { throw new Error("sessionStorage unavailable"); } });
  const beforeStorageFailureCalls = financialCalls.length, beforeStorageFailureIds = businessRequestIds.length;
  const storageFailureView = await mount({ organizationId: "org-storage-failure", sessionScope: "scope-storage-failure", invoiceId: "invoice-original" }, invoicePage, "verified-storage-failure");
  try {
    await storageFailureView.resolve(0, originalInvoice);
    assert.equal(storageFailureView.button("Take Payment").disabled, true, "unavailable session recovery disables every financial POST");
    await storageFailureView.click("Take Payment");
    assert.equal(storageFailureView.container.querySelector('[role="dialog"]'), null);
    assert.equal(financialCalls.length, beforeStorageFailureCalls);
    assert.equal(businessRequestIds.length, beforeStorageFailureIds, "storage failure does not mint or submit a financial request identity");
  } finally {
    await storageFailureView.close();
    if (sessionStorageProperty) Object.defineProperty(dom.window, "sessionStorage", sessionStorageProperty);
    else Reflect.deleteProperty(dom.window, "sessionStorage");
  }
  console.log("PASS Finance Payment/Refund exact retry identity and Stripe response session binding without SDK/network");

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
