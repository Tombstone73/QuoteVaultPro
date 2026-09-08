import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandCenter } from "./CommandCenter";

const client = new QueryClient();
client.setQueryData(["v2", "scope-a", "org-a", "action-center"], {
  items: [
    { kind: "inbound", label: "Inbound needs review", count: 2, href: "/inbound-orders" },
    { kind: "production", label: "Production remaining", count: 1, href: "/production" },
  ],
});
const markup = renderToStaticMarkup(<QueryClientProvider client={client}><CommandCenter organizationId="org-a" sessionScope="scope-a" /></QueryClientProvider>);
assert.match(markup, /Inbound needs review/);
assert.match(markup, /href="\/inbound-orders"/);
assert.match(markup, /Production remaining/);

const source = readFileSync(new URL("./CommandCenter.tsx", import.meta.url), "utf8");
assert.match(source, /actionCenterApi\.summary\(organizationId\)/, "Command Center must use the server-owned action summary.");
assert.doesNotMatch(source, /quoteApi|orderApi|financeApi/, "Command Center must not fan out into client workspace reads.");

console.log("Command Center action-summary contract tests passed.");
