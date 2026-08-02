import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("Prepress artwork relationship deduplication", () => {
  const prepress = fs.readFileSync(path.join(root, "server/routes/prepress.routes.ts"), "utf8");
  const deletion = fs.readFileSync(path.join(root, "server/routes/orderLineItemFiles.routes.ts"), "utf8");
  const lineFileService = fs.readFileSync(path.join(root, "server/services/lineItemFileRecordService.ts"), "utf8");
  const prepressPage = fs.readFileSync(path.join(root, "client/src/pages/PrepressProductionPageV2.tsx"), "utf8");

  it("prefers active Order attachment relationships over their original-file mirrors", () => {
    expect(prepress).toContain("sourceOrderAttachmentId: lineItemFiles.sourceOrderAttachmentId");
    expect(prepress).toContain("activeOrderAttachmentsByFileRecord");
    expect(prepress).toContain("safelyInferredLegacyMirror");
    expect(prepress).toContain("if (mirroredByProvenance) continue;");
    expect(prepress).toContain("if (safelyInferredLegacyMirror)");
    expect(prepress).toContain("artworkRelationshipIssueByLineItem");
  });

  it("records provenance and retires the exact source mirror before deletion", () => {
    expect(lineFileService).toContain("sourceOrderAttachmentId?: string | null");
    expect(lineFileService).toContain("sourceOrderAttachmentId: sourceOrderAttachmentId ?? null");
    expect(deletion).toContain("Do this before deleting the attachment");
    expect(deletion).toContain('eq(lineItemFiles.sourceOrderAttachmentId, fileId)');
    expect(deletion).toContain('set({ status: "retired" })');
  });

  it("provides an authenticated repair path without deleting storage", () => {
    expect(deletion).toContain("repair-artwork-relationships");
    expect(deletion).toContain("repairArtworkRelationshipsForLineItem");
    expect(prepressPage).toContain("Artwork relationship inconsistency detected");
    expect(prepressPage).toContain("Repair automatically");
  });
});
