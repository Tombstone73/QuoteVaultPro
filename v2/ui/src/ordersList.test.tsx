import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrdersList } from "./OrdersList";

const markup = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><OrdersList organizationId="organization-a" sessionScope="session-a" onOpenV2={() => undefined} onOpenLegacy={() => undefined} /></QueryClientProvider>);
assert.match(markup, /<h1[^>]*>Orders<\/h1>/);
assert.match(markup, /Filter by number, PO, customer/);
for (const column of ["Order #", "Customer", "PO", "Rep", "Lines", "Due", "Status", "Total"]) assert.match(markup, new RegExp(`>${column}<`));
for (const filter of ["All", "Open", "Cancelled"]) assert.match(markup, new RegExp(`>${filter}<`));
assert.doesNotMatch(markup, /Organization ID|Open Order ID|Authenticated route scope/);
console.log("Orders list visual contract tests passed.");
