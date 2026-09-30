import assert from "node:assert/strict";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy";
import type { Capability } from "../../src/authorization/capabilities";
import { AiAssistantWorkspace } from "./AiAssistantWorkspace";
import type { UiBootstrap } from "./api";
import { V2VisualShell, visibleNavigationSections } from "./VisualShell";
import { defaultVisualAppearance } from "./appearance";
import { readWorkspaceLocation, workspacePath } from "./productRouting";

// The standalone root tsx runner uses classic JSX rather than Vite's automatic runtime.
Object.assign(globalThis, { React, window: { location: { pathname: "/" } } });

const labels = (capabilities?: UiBootstrap["capabilities"]) =>
  visibleNavigationSections(capabilities).flatMap((section) => section.items.map((item) => item.label));

const operationalCapabilities: UiBootstrap["capabilities"] = {
  quoteOverridePrice: false,
  proofView: true,
  productionView: true,
  inboundView: true,
  fulfillmentView: true,
  teamAccessView: true,
};

const permitted = labels(operationalCapabilities);
for (const label of ["Inbound Orders", "Proofing", "Production", "Flatbed", "Roll", "Fulfillment", "Team & Access", "Themes / Appearance"]) {
  assert.ok(permitted.includes(label), `${label} should be exposed when permitted`);
}
for (const label of ["Quotes", "Orders", "Products", "Inventory", "QuickBooks", "Formula Library"]) {
  assert.ok(!permitted.includes(label), `${label} should not be exposed without its capability`);
}

for (const label of ["Nesting", "Materials", "Procurement", "Design", "Shipping", "Reports", "Communications", "Integrations", "Bug Reports"]) {
  assert.ok(!labels().includes(label), `${label} is not an operational V2 destination`);
}

const assistantCapability = (grants: readonly Capability[]): UiBootstrap["capabilities"] => ({
  quoteOverridePrice: false,
  assistantUse: new AuthorityPolicy().decide({
    kind: "staff", organizationId: "org-a", userId: "staff-a",
    authority: { membershipId: "membership-a", capabilities: grants },
  }, { capability: "assistant.use", resource: { organizationId: "org-a" } }).allowed,
});
const authorized = assistantCapability(["assistant.use"]);
const unrelated = { ...assistantCapability(["product.view", "product.edit", "quote.view", "organization.configure", "permissions.manageSets"]), productView: true, quoteView: true, organizationConfigure: true, teamAccessView: true };
for (const capabilities of [undefined, operationalCapabilities, unrelated, assistantCapability([])]) {
  assert.ok(!labels(capabilities).includes("AI Assistant"), "AI navigation requires an explicit assistant.use grant");
}
assert.ok(labels(authorized).includes("AI Assistant"), "assistant.use alone permits AI navigation");
for (const label of ["Products", "Quotes", "Settings", "Team & Access"]) {
  assert.ok(labels(unrelated).includes(label), `${label} retains its unrelated navigation permission`);
}
assert.ok(labels().includes("Products"), "other navigation retains its existing pre-bootstrap fallback");
assert.deepEqual(readWorkspaceLocation("/assistant"), { page: "assistant" });
assert.equal(workspacePath("assistant"), "/assistant");

const markup = renderToStaticMarkup(
  <V2VisualShell
    page="home"
    onNavigate={() => undefined}
    appearance={defaultVisualAppearance}
    setAppearance={() => undefined}
    capabilities={operationalCapabilities}
  >
    <div />
  </V2VisualShell>,
);
assert.match(markup, /href="\/production\/flatbed"/);
assert.match(markup, /href="\/production\/roll"/);
assert.match(markup, /href="\/settings\?section=staff"/);
assert.doesNotMatch(markup, /New Quote|New Order/);
assert.doesNotMatch(markup, /AI Assistant/);

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/assistant" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const root = createRoot(document.getElementById("root")!);
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Navigation and cached workspace transitions must not fetch"); };
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
client.setQueryData(["v2", "scope-a", "org-a", "assistant", "conversations", undefined], [{ id: "conversation-a", title: "Authorized conversation", updatedAt: "2026-09-30T00:00:00Z" }]);
client.setQueryData(["v2", "scope-a", "org-a", "assistant", "messages", "conversation-a"], []);
client.setQueryData(["v2", "scope-a", "org-a", "assistant", "pending", "conversation-a"], null);
const render = async (capabilities?: UiBootstrap["capabilities"]) => {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>
      <V2VisualShell page="assistant" onNavigate={() => undefined} appearance={defaultVisualAppearance} setAppearance={() => undefined} capabilities={capabilities}>
        <AiAssistantWorkspace organizationId="org-a" sessionScope="scope-a" canUse={capabilities?.assistantUse === true} csrfReady />
      </V2VisualShell>
    </QueryClientProvider>);
  });
};
try {
  for (const capabilities of [undefined, unrelated, authorized, assistantCapability([]), undefined, authorized]) {
    await render(capabilities);
    const allowed = capabilities?.assistantUse === true;
    const nav = document.querySelector('nav button[title="AI Assistant"]');
    assert.equal(Boolean(nav), allowed, "navigation follows current permissions through grant, revocation and bootstrap reset");
    if (allowed) {
      assert.equal(nav?.getAttribute("aria-current"), "page");
      assert.match(document.body.textContent ?? "", /New conversation/);
      assert.match(document.body.textContent ?? "", /Authorized conversation/);
      assert.doesNotMatch(document.body.textContent ?? "", /do not have permission to use/);
    } else {
      assert.match(document.body.textContent ?? "", /You do not have permission to use the AI Assistant/);
      assert.doesNotMatch(document.body.textContent ?? "", /New conversation|Authorized conversation|GO/);
    }
    assert.equal(requests, 0, "denied direct access and cached permission transitions perform no API requests");
  }
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
  client.clear();
  dom.window.close();
}

console.log("Visual shell navigation capability tests passed.");
