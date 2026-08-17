import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotesList } from "./QuotesList";

const markup = renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <QuotesList
      organizationId="organization-a"
      sessionScope="session-a"
      canCreate
      onCreate={() => undefined}
      onOpenV2={() => undefined}
    />
  </QueryClientProvider>,
);

assert.match(markup, /<h1[^>]*>Quotes<\/h1>/);
assert.match(markup, /Filter by number, PO, customer/);
assert.match(markup, /Quote #/);
assert.match(markup, /Customer/);
assert.match(markup, /PO/);
assert.match(markup, /Rep/);
assert.match(markup, /Lines/);
assert.match(markup, /Due/);
assert.match(markup, /Status/);
assert.match(markup, /Total/);
for (const filter of ["All", "Draft", "Sent", "Accepted", "Converted"]) assert.match(markup, new RegExp(`>${filter}<`));
assert.match(markup, /New Quote/);
assert.doesNotMatch(markup, /Organization ID|Authenticated route scope|Sales organization/);

console.log("Quotes list visual contract tests passed.");
