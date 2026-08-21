import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesEntryWorkspace } from "./SalesEntryWorkspace";
import { V2VisualShell } from "./VisualShell";
import { defaultVisualAppearance } from "./appearance";
import { AuthSessionControlsContext } from "./AuthGate";

Object.assign(globalThis, { window: { location: { pathname: "/" } } });

const render = (mode: "quote" | "order") => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <SalesEntryWorkspace mode={mode} organizationId="org-a" sessionScope="scope-a" canCreate canOverridePrice csrfReady onCancel={() => undefined} />
  </QueryClientProvider>,
);

for (const [mode, action] of [["quote", "Create Quote"], ["order", "Create Order"]] as const) {
  const markup = render(mode);
  assert.match(markup, new RegExp(`New ${mode === "quote" ? "Quote" : "Order"}`));
  assert.match(markup, /Add Item/);
  assert.match(markup, new RegExp(action));
  assert.match(markup, /aria-label="Customer"/);
  assert.match(markup, /aria-label="Contact"/);
}

const shell = renderToStaticMarkup(<V2VisualShell page="home" onNavigate={() => undefined} appearance={defaultVisualAppearance} setAppearance={() => undefined}><div /></V2VisualShell>);
assert.match(shell, /aria-haspopup="menu"/);
assert.match(shell, />\s*New</);

const authenticatedShell = renderToStaticMarkup(
  <AuthSessionControlsContext.Provider value={{ displayName: "dale@titan-graphics.com", busy: false, signOut: () => undefined }}>
    <V2VisualShell page="home" onNavigate={() => undefined} appearance={defaultVisualAppearance} setAppearance={() => undefined}><div /></V2VisualShell>
  </AuthSessionControlsContext.Provider>,
);
assert.equal((authenticatedShell.match(/<header/g) ?? []).length, 1);
assert.match(authenticatedShell, /<header class="v2-topbar">[\s\S]*dale@titan-graphics\.com[\s\S]*Sign out[\s\S]*<\/header>/);
assert.doesNotMatch(authenticatedShell, /<\/header><header class="v2-auth-session"/);

console.log("Sales entry visual contract tests passed.");
