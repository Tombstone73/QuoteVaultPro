import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = await readFile(path.join(process.cwd(), "v2", "infrastructure", "artwork", "postgresQuoteArtworkTransaction.ts"), "utf8");

assert.match(
  source,
  /concat_ws\('\|',s\.id,\$4::text,\$5::text\)/,
  "Quote-to-Order artwork reuse must cast order parameters before the polymorphic fingerprint call.",
);
console.log("Quote Artwork conversion SQL uses unambiguous text parameters.");
