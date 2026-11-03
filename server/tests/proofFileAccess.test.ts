import { expect, jest, test } from "@jest/globals";
import { PDFDocument } from "pdf-lib";
import { readProofFile } from "../services/proofFileAccess";

const reference = { fileRecordId: "canonical-proof", fileName: "proof.pdf", mimeType: "application/pdf", fileUrl: "old-path" };
async function pdf() { const document = await PDFDocument.create(); document.addPage([144, 108]); return Buffer.from(await document.save()); }
test("reads and validates the original proof PDF without substituting legacy artwork", async () => {
  const buffer = await pdf();
  const readCanonical = jest.fn(async () => ({ buffer, filename: "proof.pdf", mimeType: "application/pdf" }));
  const readLegacy = jest.fn(async () => null);
  expect((await readProofFile("org", reference, { readCanonical, readLegacy })).buffer).toEqual(buffer);
  expect(readCanonical).toHaveBeenCalledWith({ organizationId: "org", fileRecordId: "canonical-proof", variant: "original" });
  expect(readLegacy).not.toHaveBeenCalled();
});
test.each([null, Buffer.alloc(0), Buffer.from("<html>login</html>")])("rejects missing/invalid proof bytes: %p", async buffer => {
  await expect(readProofFile("org", reference, {
    readCanonical: async () => buffer === null ? null : ({ buffer, filename: "proof.pdf", mimeType: "application/pdf" }),
    readLegacy: async () => { throw new Error("must not fall back"); },
  })).rejects.toMatchObject({ code: "PROOF_FILE_UNAVAILABLE", statusCode: 409 });
});
test("keeps historical original references readable without a canonical file record", async () => {
  const buffer = await pdf();
  const readLegacy = jest.fn(async () => ({ buffer, filename: "old-proof.pdf", mimeType: "application/pdf" }));
  await expect(readProofFile("org", { ...reference, fileRecordId: null }, { readCanonical: async () => null, readLegacy })).resolves.toMatchObject({ buffer });
  expect(readLegacy).toHaveBeenCalledWith({ organizationId: "org", file: { ...reference, fileRecordId: null } });
});
