import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../../server/storage/quotes.repo.ts", import.meta.url), "utf8");
const start = source.indexOf("async createQuote(");
const end = source.indexOf("async getQuoteById(", start);

assert.ok(start >= 0 && end > start, "Quote creation implementation must remain addressable.");
const createQuote = source.slice(start, end);

assert.match(
  createQuote,
  /return this\.dbInstance\.transaction\(async \(executor\) => this\.createQuoteWithinTransaction\(organizationId, data, executor\)\);/,
  "Quote creation must enter one transaction before allocating its number.",
);
assert.match(createQuote, /allocateDocumentNumber\(organizationId, "quote", executor\)/);
assert.match(createQuote, /executor\.insert\(quotes\)/);
assert.match(createQuote, /executor\.insert\(quoteLineItems\)/);
assert.doesNotMatch(
  createQuote.slice(createQuote.indexOf("private async createQuoteWithinTransaction")),
  /this\.dbInstance\./,
  "All header, line, and temporary-line adoption writes must use the same transaction executor.",
);

console.log("legacy quote create atomicity contract passed");
