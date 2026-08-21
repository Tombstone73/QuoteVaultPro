import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesEntryWorkspace } from "./SalesEntryWorkspace";
import { V2VisualShell } from "./VisualShell";
import { defaultVisualAppearance } from "./appearance";

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

console.log("Sales entry visual contract tests passed.");
