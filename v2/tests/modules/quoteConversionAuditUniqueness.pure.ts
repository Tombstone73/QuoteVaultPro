import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../src/modules/sales/quoteConversionApplication.ts", import.meta.url), "utf8");
const accept = source.slice(source.indexOf("async accept("), source.indexOf("async convert("));
const convertAccepted = source.slice(source.indexOf("private async convertAccepted("));
const quoteAudits = [...convertAccepted.matchAll(/transaction\.quote\.audit\(/g)];

assert.equal(quoteAudits.length, 1, "one accept-and-convert request may write only one Quote audit row");
assert(convertAccepted.includes('eventType: "quote_converted"'), "the final atomic conversion is the retained Quote audit event");
assert(!accept.includes("quote.audit("), "acceptance remains immutable checkpoint evidence, not a duplicate request/resource audit row");
console.log("[quote-conversion-audit] combined acceptance/conversion preserves the one request/resource audit invariant.");
