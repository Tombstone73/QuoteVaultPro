import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = await readFile(path.join(process.cwd(), "v2", "infrastructure", "artwork", "postgresQuoteArtworkTransaction.ts"), "utf8");

assert.match(
  source,
  /concat_ws\('\|',s\.id,\$4::varchar,\$5::varchar\)/,
  "Quote-to-Order artwork reuse must keep Order parameter types consistent in the fingerprint call.",
);
console.log("Quote Artwork conversion SQL uses unambiguous text parameters.");
