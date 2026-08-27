import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      onOpenLegacy={() => undefined}
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
assert.match(markup, /Due from/);
assert.match(markup, /Updated: newest/);
assert.match(markup, /Actions/);
assert.doesNotMatch(markup, /Organization ID|Authenticated route scope|Sales organization/);

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
assert.match(styles, /\.v2-workspace\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none[^}]*margin:\s*0[^}]*padding:\s*0[^}]*\}/s);
assert.doesNotMatch(styles, /(?:^|\n)main\s*\{[^}]*max-width:/s, "operational main must not inherit a fixed-width legacy container");

console.log("Quotes list visual contract tests passed.");
