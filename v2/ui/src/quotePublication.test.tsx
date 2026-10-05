import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalQuoteDetail, PortalQuotes } from "./PortalQuotes";
import { QuotePublicationPanel } from "./QuotePublicationPanel";
import { clearV2ApiSessionState, quoteApi } from "./api";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/portal/quotes/quote-a" });
const globals = { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const originalFetch = globalThis.fetch;
const { createRoot } = await import("react-dom/client");
const root = createRoot(document.getElementById("root")!);
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, placeholderData: (previousData: unknown) => previousData } } });
const calls: { path: string; resolve: (response: Response) => void }[] = [];
let providerWrites = 0, resendInvocations = 0, cases = 0;
globalThis.fetch = async (input, init) => {
  const path = String(input);
  assert.ok(path.startsWith("/v2/portal/quotes") || /^\/v2\/organizations\/org-[ab]\/quotes\/quote-a\/publications$/.test(path));
  if (init?.method && init.method !== "GET") { providerWrites++; throw new Error("Mutation/network provider writes forbidden."); }
  assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "include");
  return new Promise(resolve => calls.push({ path, resolve }));
};
const text = () => document.body.textContent ?? "";
const summary = (checkpointId: string, cents = 247) => ({ quoteId: "quote-a", number: "QT-1", createdAt: "2026-10-03T14:00:00Z", status: "sent", total: { cents, currency: "USD" }, checkpointId, evidenceStatus: "modern" });
const detail = (checkpointId = "published-1", description = "Frozen sent line", cents = 247) => ({ ...summary(checkpointId, cents), history: [summary("published-2", 347), summary("published-1")],
  lines: [{ lineId: "line-a", description, quantity: 2, unitPrice: { cents: 100, currency: "USD" }, lineTotal: { cents: 200, currency: "USD" } }],
  // Extra transport fields must never be rendered or interpreted as publication.
  internalRevision: { description: "INTERNAL_UNSENT_SECRET", total: 99999 } });
async function settle(predicate: () => boolean) { for (let attempt = 0; attempt < 150 && !predicate(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); assert.ok(predicate(), text()); }
async function render(component: React.ReactNode) { await act(async () => root.render(<QueryClientProvider client={client}>{component}</QueryClientProvider>)); }
async function respond(index: number, data: unknown, status = 200) { const scope = calls[index].path.startsWith("/v2/organizations/org-a/") ? "staff-a" : calls[index].path.startsWith("/v2/organizations/org-b/") ? "staff-b" : undefined; await act(async () => calls[index].resolve(new Response(JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: { code: "FORBIDDEN", message: "PRIVATE_DENIAL" } }), { status, headers: { "content-type": "application/json", ...(scope ? { "x-v2-session-scope": scope } : {}) } }))); }
async function check(name: string, action: () => Promise<void>) { await action(); cases++; console.log(`PASS ${name}`); }
try {
  await check("Portal displays last sent commercial total, not internal revision", async () => {
    await render(<PortalQuoteDetail key="scope-a:quote-a" quoteId="quote-a" sessionScope="scope-a" />); await settle(() => calls.length === 1);
    await respond(0, detail()); await settle(() => text().includes("Frozen sent line"));
    assert.match(text(), /\$2\.47/); assert.doesNotMatch(text(), /INTERNAL_UNSENT_SECRET|99999/);
    assert.equal(document.querySelector<HTMLAnchorElement>('a[target="_blank"]')?.getAttribute("href"), "/v2/portal/quotes/quote-a/document.pdf?checkpointId=published-1");
  });
  await check("explicit history read uses exact checkpoint without mutation", async () => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent?.includes("$3.47"))!;
    await act(async () => button.click()); await settle(() => calls.length === 2);
    assert.equal(calls[1].path, "/v2/portal/quotes/quote-a?checkpointId=published-2");
    assert.doesNotMatch(text(), /Frozen sent line/);
    await respond(1, detail("published-2", "New explicitly published line", 347)); await settle(() => text().includes("New explicitly published line"));
    assert.match(text(), /\$3\.47/);
    assert.equal(document.querySelector<HTMLAnchorElement>('a[target="_blank"]')?.getAttribute("href"), "/v2/portal/quotes/quote-a/document.pdf?checkpointId=published-2");
  });
  await check("permission loss hides retained successful cache", async () => {
    await act(async () => { void client.invalidateQueries({ queryKey: ["v2", "portal", "scope-a", "quotes", "quote-a", "published-2"] }); });
    await settle(() => calls.length === 3 && text().includes("Loading published Quote")); assert.doesNotMatch(text(), /New explicitly published line/);
    await respond(2, null, 403); await settle(() => Boolean(document.querySelector('[role="alert"]')));
    assert.doesNotMatch(text(), /New explicitly published line|PRIVATE_DENIAL/);
  });
  await check("read-only recovery cannot send or replay a Quote", async () => {
    const button = [...document.querySelectorAll("button")].find(node => node.textContent === "Retry published Quote read")!;
    await act(async () => button.click()); await settle(() => calls.length === 4);
    await respond(3, detail("published-2", "Recovered published line", 347)); await settle(() => text().includes("Recovered published line"));
    assert.equal(providerWrites, 0);
  });
  await check("customer/session replacement fences old cached and late data", async () => {
    await render(<PortalQuoteDetail key="scope-b:quote-a" quoteId="quote-a" sessionScope="scope-b" />); await settle(() => calls.length === 5);
    assert.doesNotMatch(text(), /Recovered published line/);
    await render(<PortalQuoteDetail key="scope-c:quote-a" quoteId="quote-a" sessionScope="scope-c" />); await settle(() => calls.length === 6);
    await respond(4, detail("published-old", "OTHER_CUSTOMER_SECRET"));
    assert.doesNotMatch(text(), /OTHER_CUSTOMER_SECRET/);
    await respond(5, detail("published-c", "Current customer proposal")); await settle(() => text().includes("Current customer proposal"));
    assert.doesNotMatch(text(), /OTHER_CUSTOMER_SECRET/);
  });
  await check("never-published list is honestly empty", async () => {
    await render(<PortalQuotes sessionScope="scope-empty" />); await settle(() => calls.length === 7);
    await respond(6, { items: [] }); await settle(() => text().includes("No published quotes"));
    assert.doesNotMatch(text(), /Current customer proposal|INTERNAL/);
  });
  await check("Staff resend is explicit and sent history preserves frozen Job Label", async () => {
    await render(<QuotePublicationPanel organizationId="org-a" sessionScope="staff-a" quoteId="quote-a" revision="7" publishedCheckpointId="cp-a" canView canResend busy={false} loadHistory={() => quoteApi.publications("org-a", "quote-a")} onResend={() => resendInvocations++} />);
    await settle(() => calls.length === 8);
    const frozen = { checkpointId: "cp-a", occurredAt: "2026-10-03T14:00:00Z", customerPresentation: { customerDisplayName: "Frozen customer" }, sentEvidence: { recipientEmail: "frozen@example.invalid" }, commercial: { jobLabel: "Frozen M7 Job Label", terms: { commercialNotes: "Frozen notes" } } };
    await respond(7, { items: [frozen, { ...frozen, checkpointId: "cp-old", commercial: { ...frozen.commercial, jobLabel: "Selected historical Job Label" } }, { ...frozen, checkpointId: "cp-next", commercial: { ...frozen.commercial, jobLabel: "Current published Job Label" } }] });
    await settle(() => text().includes("Frozen M7 Job Label")); assert.match(text(), /Internal revision 7|Saving changes does not publish/);
    assert.equal(resendInvocations, 0);
    const button = [...document.querySelectorAll("button")].find(node => node.textContent === "Resend Current Internal Revision")!;
    await act(async () => button.click()); assert.equal(resendInvocations, 1);
    await act(async () => { const select = document.querySelector("select")!; select.value = "cp-old"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.match(text(), /Selected historical Job Label/);
    await render(<QuotePublicationPanel organizationId="org-a" sessionScope="staff-a" quoteId="quote-a" revision="7" publishedCheckpointId="cp-next" canView canResend busy={false} loadHistory={() => quoteApi.publications("org-a", "quote-a")} onResend={() => resendInvocations++} />);
    assert.match(text(), /Current published Job Label/); assert.doesNotMatch(text(), /Selected historical Job Label/);
    assert.equal(document.querySelector<HTMLSelectElement>("select")?.value, "cp-next", "selection rebinds to the new committed checkpoint even without a component remount");
    await render(<QuotePublicationPanel organizationId="org-a" sessionScope="staff-a" quoteId="quote-a" revision="7" publishedCheckpointId="cp-next" canView={false} canResend busy={false} loadHistory={() => quoteApi.publications("org-a", "quote-a")} onResend={() => resendInvocations++} />);
    assert.doesNotMatch(text(), /Current published Job Label|frozen@example/); assert.equal(document.querySelector("select"), null); assert.equal(calls.length, 8);
  });
  await check("Staff grant loss disables resend and clears prior account history", async () => {
    clearV2ApiSessionState();
    await render(<QuotePublicationPanel organizationId="org-b" sessionScope="staff-b" quoteId="quote-a" revision="7" publishedCheckpointId={null} canView canResend={false} busy={false} loadHistory={() => quoteApi.publications("org-b", "quote-a")} onResend={() => resendInvocations++} />);
    await settle(() => calls.length === 9); assert.doesNotMatch(text(), /Frozen M7 Job Label|frozen@example/);
    await respond(8, null, 403); await settle(() => Boolean(document.querySelector('[role="alert"]')));
    assert.equal([...document.querySelectorAll("button")].find(node => node.textContent === "Send Current Internal Revision")?.disabled, true);
    assert.equal(resendInvocations, 1); assert.equal(providerWrites, 0);
  });
  await check("legacy frozen readability carries an honest incomplete-evidence warning", async () => {
    const before = calls.length;
    await render(<PortalQuoteDetail key="historical" quoteId="quote-a" sessionScope="historical" />); await settle(() => calls.length === before + 1);
    await respond(before, { ...detail("legacy-checkpoint", "Legacy frozen line"), evidenceStatus: "historical" });
    await settle(() => text().includes("Legacy frozen line"));
    assert.match(text(), /Original delivery or PDF evidence may be incomplete/); assert.doesNotMatch(text(), /INTERNAL_UNSENT_SECRET/);
    assert.equal(providerWrites, 0);
  });
  console.log(`L0-A-UI: ${cases} mounted publication scenarios; inert read mocks, zero provider/network mutations.`);
} finally {
  await act(async () => root.unmount()); client.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch; dom.window.close();
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
}
