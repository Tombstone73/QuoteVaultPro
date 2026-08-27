import assert from "node:assert/strict";
import { assertOwnerDocumentSafe, ownerDocumentFilename, renderOwnerPdf } from "../../infrastructure/documents/ownerPdfRenderer.js";

const document = {
  kind: "traveler" as const, title: "Production traveler · ORD-1010", number: "ORD-1010", issuedAt: "2026-08-27",
  organization: { name: "Tenant Print", address: "1 Main St", email: "ops@example.test" },
  sections: [
    { heading: "Production work", entries: [{ label: "Line", value: "Coroplast sign" }, { label: "Quantity ordered", value: "2" }, { label: "Artwork", value: "Artwork attached · Front" }] },
  ],
};

assert.equal(ownerDocumentFilename(document), "Traveler_ORD-1010.pdf");
assert.match(Buffer.from(await renderOwnerPdf(document)).subarray(0, 8).toString("ascii"), /^%PDF-/);
assert.throws(() => assertOwnerDocumentSafe({ ...document, sections: [{ heading: "Unsafe", entries: [{ value: "2b4e166c-2034-4c42-9b2f-24a21d6d33cd" }] }] }), /internal identifier/i);
assert.throws(() => assertOwnerDocumentSafe({ ...document, sections: [{ heading: "Unsafe", entries: [{ value: "opt_sides" }] }] }), /internal identifier/i);
assert.throws(() => assertOwnerDocumentSafe({ ...document, sections: [{ heading: "Unsafe", entries: [{ value: "productId 123" }] }] }), /internal identifier/i);
console.log("Owner document rendering tests passed.");
