import assert from "node:assert/strict";
import { quoteArtworkForUi } from "../../src/interfaces/http/quoteRoutes.js";

const projection = quoteArtworkForUi([{
  assignment: { id: "assignment-a" as never, organizationId: "org-a" as never, quoteId: "quote-a" as never, quoteLineId: "line-a" as never, artworkFileId: "file-a" as never, purpose: "customer_supplied", side: "front", createdAt: "2026-08-29T00:00:00.000Z" },
  file: { id: "file-a" as never, organizationId: "org-a" as never, objectReference: { storageProvider: "supabase", objectKey: "private/not-for-ui" }, originalFilename: "qa.pdf", displayFilename: "qa.pdf", contentType: "application/pdf", byteSize: 123, source: "customer_upload", createdAt: "2026-08-29T00:00:00.000Z" },
}]);
assert.equal(projection[0]?.association.quoteLineId, "line-a");
assert.equal(projection[0]?.file.displayFilename, "qa.pdf");
assert.equal("objectReference" in (projection[0]?.file ?? {}), false);
console.log("Quote Artwork HTTP list projection preserves the UI association contract.");
