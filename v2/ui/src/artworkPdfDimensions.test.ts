import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectArtworkPdfBytes } from "./artworkPdfDimensions";

const inspection = await inspectArtworkPdfBytes(new Uint8Array(await readFile("v2/tests/fixtures/p7-qa-artwork.pdf")));
assert.equal(inspection.kind, "common_size");
if (inspection.kind === "common_size") {
  assert.equal(inspection.size.widthIn, 2);
  assert.equal(inspection.size.heightIn, 2);
  assert.equal(inspection.size.pageCount, 1);
}
console.log("Artwork PDF dimension inspection passed.");
