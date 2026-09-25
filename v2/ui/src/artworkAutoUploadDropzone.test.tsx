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
const assignmentFailure = { code: "VALIDATION_ERROR", message: "Artwork replacement must explicitly supersede the current customer-supplied Order-line slot" };
assert.equal(artworkUploadErrorMessage(assignmentFailure), "Artwork could not be assigned to this Order line because it already has Artwork in this position. Existing artwork was not changed.");
for (const message of ["businessRequestId is required.", "Artwork side is invalid.", "unexpected database detail"]) {
  assert.equal(artworkUploadErrorMessage({ code: "VALIDATION_ERROR", message }), "Artwork upload could not be completed. Check the upload details and try again.");
}
for (const code of ["NOT_PDF", "CORRUPT_PDF"]) {
  assert.equal(artworkUploadErrorMessage({ code }), "The selected file is not a readable PDF. Choose a valid PDF and try again.");
}
assert.equal(artworkUploadErrorMessage({ code: "SIZE_LIMIT" }), "The selected PDF exceeds the 10 MB upload limit.");
assert.equal(artworkUploadErrorMessage({ code: "UPLOAD_TRANSPORT_CORRUPTION" }), "Artwork upload could not be read. Retry the upload.");
assert.equal(artworkUploadErrorMessage({ code: "CONFLICT", message: "internal detail" }), "Artwork changed while this upload was in progress. Refresh the Order and try again.");
assert.equal(artworkUploadErrorMessage({ code: "UNEXPECTED", message: "internal detail" }), "Artwork upload failed. Existing artwork was not changed.");
const validationMarkup = renderToStaticMarkup(<ArtworkAutoUploadDropzone label="Order artwork PDF" isUploading={false} isSuccess={false} error={{ code: "VALIDATION_ERROR" }} onFileSelected={() => undefined} />);
assert.match(validationMarkup, /Check the upload details/, "generic command failures must not blame PDF bytes");
assert.doesNotMatch(validationMarkup, /not a valid PDF|not a readable PDF/);
const assignmentMarkup = renderToStaticMarkup(<ArtworkAutoUploadDropzone label="Order artwork PDF" isUploading={false} isSuccess={false} error={assignmentFailure} onFileSelected={() => undefined} />);
assert.match(assignmentMarkup, /Artwork could not be assigned to this Order line/);
assert.doesNotMatch(assignmentMarkup, /not a valid PDF|not a readable PDF|explicitly supersede/);

const source = await readFile(new URL("./ArtworkAutoUploadDropzone.tsx", import.meta.url), "utf8");
assert.match(source, /onDrop=/, "drag/drop must invoke the same selected-file callback");
assert.match(source, /onFileSelected\(file\)/, "valid selections must begin upload without a confirmation button");
assert.match(source, /Retry upload/, "failed uploads retain an explicit retry path");
console.log("Artwork auto-upload dropzone contracts passed.");
