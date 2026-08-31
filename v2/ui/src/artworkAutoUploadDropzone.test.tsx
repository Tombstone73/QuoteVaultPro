import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtworkAutoUploadDropzone, isArtworkPdf } from "./ArtworkAutoUploadDropzone";

const markup = renderToStaticMarkup(<ArtworkAutoUploadDropzone label="Order artwork PDF" isUploading={false} isSuccess={false} onFileSelected={() => undefined} />);
assert.match(markup, /role="button"/);
assert.match(markup, /Drag a PDF here or click to select/);
assert.match(markup, /accept="application\/pdf,.pdf"/);
assert.match(markup, /PDF only/);
assert.doesNotMatch(markup, />Upload Artwork<\/button>/);

assert.equal(isArtworkPdf(new File(["%PDF"], "proof.pdf", { type: "application/pdf" })), true);
assert.equal(isArtworkPdf(new File(["pdf without MIME"], "proof.pdf")), true);
assert.equal(isArtworkPdf(new File(["png"], "proof.png", { type: "image/png" })), false);

const source = await readFile(new URL("./ArtworkAutoUploadDropzone.tsx", import.meta.url), "utf8");
assert.match(source, /onDrop=/, "drag/drop must invoke the same selected-file callback");
assert.match(source, /onFileSelected\(file\)/, "valid selections must begin upload without a confirmation button");
assert.match(source, /Retry upload/, "failed uploads retain an explicit retry path");
console.log("Artwork auto-upload dropzone contracts passed.");
