import assert from "node:assert/strict";
import { quoteRouteMode } from "./quoteRouteMode";

assert.equal(quoteRouteMode({ quoteId: "", createRequested: true, hasQuote: false, hasError: false }), "create");
assert.equal(quoteRouteMode({ quoteId: "quote-1", createRequested: true, hasQuote: false, hasError: false }), "loading-existing");
assert.equal(quoteRouteMode({ quoteId: "quote-1", createRequested: false, hasQuote: true, hasError: false }), "existing");
assert.equal(quoteRouteMode({ quoteId: "quote-1", createRequested: false, hasQuote: false, hasError: true }), "unavailable");
assert.equal(quoteRouteMode({ quoteId: "", createRequested: false, hasQuote: false, hasError: false }), "list");
