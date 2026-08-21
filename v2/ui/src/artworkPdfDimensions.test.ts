import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, degrees } from "pdf-lib";
import { inspectArtworkPdfBytes } from "./artworkPdfDimensions";

const inspect = async (document: PDFDocument) =>
  inspectArtworkPdfBytes(new Uint8Array(await document.save()));

const fixture = await inspectArtworkPdfBytes(
  new Uint8Array(await readFile("v2/tests/fixtures/p7-qa-artwork.pdf")),
);
assert.equal(fixture.kind, "common_size");
if (fixture.kind === "common_size") {
  assert.equal(fixture.size.widthIn, 2);
  assert.equal(fixture.size.heightIn, 2);
  assert.equal(fixture.size.pageCount, 1);
}

const rotated = await PDFDocument.create();
rotated.addPage([144, 72]).setRotation(degrees(90));
assert.deepEqual(await inspect(rotated), {
  kind: "common_size",
  size: { widthIn: 1, heightIn: 2, pageCount: 1, pageBox: "crop_or_media" },
});

const sameSize = await PDFDocument.create();
sameSize.addPage([144, 72]);
sameSize.addPage([144, 72]);
const sameSizeInspection = await inspect(sameSize);
assert.equal(sameSizeInspection.kind, "common_size");
if (sameSizeInspection.kind === "common_size") assert.equal(sameSizeInspection.size.pageCount, 2);

const mixedSize = await PDFDocument.create();
mixedSize.addPage([144, 72]);
mixedSize.addPage([72, 72]);
assert.deepEqual(await inspect(mixedSize), { kind: "mixed_sizes", pageCount: 2 });

console.log("Artwork PDF dimension inspection passed.");
