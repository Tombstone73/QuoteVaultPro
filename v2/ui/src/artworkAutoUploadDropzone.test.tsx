import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtworkAutoUploadDropzone, artworkUploadErrorMessage, isArtworkPdf } from "./ArtworkAutoUploadDropzone";

const markup = renderToStaticMarkup(<ArtworkAutoUploadDropzone label="Order artwork PDF" isUploading={false} isSuccess={false} onFileSelected={() => undefined} />);
assert.match(markup, /role="button"/);
assert.match(markup, /Drag a PDF here or click to select/);
assert.match(markup, /accept="application\/pdf,.pdf"/);
assert.match(markup, /PDF only/);
assert.doesNotMatch(markup, />Upload Artwork<\/button>/);

assert.equal(isArtworkPdf(new File(["%PDF"], "proof.pdf", { type: "application/pdf" })), true);
assert.equal(isArtworkPdf(new File(["pdf without MIME"], "proof.pdf")), true);
assert.equal(isArtworkPdf(new File(["png"], "proof.png", { type: "image/png" })), false);
assert.equal(artworkUploadErrorMessage({ code: "VALIDATION_ERROR", message: "Only valid PDF Artwork files are supported." }), "The selected file is not a valid PDF. Choose a valid PDF and try again.");
assert.equal(artworkUploadErrorMessage({ code: "CONFLICT", message: "internal detail" }), "Artwork changed while this upload was in progress. Refresh the Order and try again.");
assert.equal(artworkUploadErrorMessage({ code: "UNEXPECTED", message: "internal detail" }), "Artwork upload failed. Existing artwork was not changed.");
const validationMarkup = renderToStaticMarkup(<ArtworkAutoUploadDropzone label="Order artwork PDF" isUploading={false} isSuccess={false} error={{ code: "VALIDATION_ERROR" }} onFileSelected={() => undefined} />);
assert.match(validationMarkup, /The selected file is not a valid PDF/, "canonical validation failures must show safe staff guidance rather than the generic fallback");

const source = await readFile(new URL("./ArtworkAutoUploadDropzone.tsx", import.meta.url), "utf8");
assert.match(source, /onDrop=/, "drag/drop must invoke the same selected-file callback");
assert.match(source, /onFileSelected\(file\)/, "valid selections must begin upload without a confirmation button");
assert.match(source, /Retry upload/, "failed uploads retain an explicit retry path");
console.log("Artwork auto-upload dropzone contracts passed.");
