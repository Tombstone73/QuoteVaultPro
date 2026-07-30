import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

describe("Storage reference guard contract", () => {
  const root = process.cwd();
  const guard = fs.readFileSync(path.join(root, "server/services/storage/storageReferenceGuard.ts"), "utf8");
  const orderLineFilesRoute = fs.readFileSync(path.join(root, "server/routes/orderLineItemFiles.routes.ts"), "utf8");
  const orderRoute = fs.readFileSync(path.join(root, "server/routes/orders.routes.ts"), "utf8");
  const quoteLineFilesRoute = fs.readFileSync(path.join(root, "server/routes/quoteLineItemFiles.routes.ts"), "utf8");
  const attachmentRoute = fs.readFileSync(path.join(root, "server/routes/attachments.routes.ts"), "utf8");

  test("shared cleanup guard counts all known live storage consumers", () => {
    expect(guard).toContain("export async function countLiveStorageReferences");
    expect(guard).toContain("lineItemFiles");
    expect(guard).toContain("eq(lineItemFiles.status, \"active\")");
    expect(guard).toContain("orderAttachments");
    expect(guard).toContain("quoteAttachments");
    expect(guard).toContain("assets");
    expect(guard).toContain("fileDerivatives");
    expect(guard).toContain("quoteAttachmentPages");
    expect(guard).toContain("inboundOrderFiles");
    expect(guard).toContain("lineItemProofVersions");
    expect(guard).toContain("sharedStoragePlacements");
  });

  test("physical storage deletion is blocked while live references remain and fails closed", () => {
    expect(guard).toContain("deleteStoredObjectKeysIfUnreferenced");
    expect(guard).toContain("references.totalLiveReferences > 0");
    expect(guard).toContain("reason: references.failedClosed ? \"reference_check_failed\" : \"live_references\"");
    expect(guard).toContain("Reference check failed; preserving stored object");
    expect(guard).toContain("totalLiveReferences: 1");
    expect(guard).toContain("failedClosed: true");
  });

  test("all attachment cleanup routes use the shared guard for physical deletes", () => {
    for (const source of [orderLineFilesRoute, orderRoute, quoteLineFilesRoute, attachmentRoute]) {
      expect(source).toContain("deleteStoredObjectKeysIfUnreferenced");
    }
    expect(orderLineFilesRoute).not.toContain("deleteStoredObjectKeys({");
    expect(orderRoute).not.toContain("deleteStoredObjectKeys({");
    expect(quoteLineFilesRoute).not.toContain("deleteStoredObjectKeys({");
    expect(attachmentRoute).not.toContain("deleteStoredObjectKeys({");
  });

  test("customer artwork deletion does not supersede independent production assignments", () => {
    const deletedAttachmentBranchStart = orderLineFilesRoute.indexOf("if (deletedAttachment.length)");
    const deletedAttachmentBranchEnd = orderLineFilesRoute.indexOf("const fallbackAssets", deletedAttachmentBranchStart);
    const deletedAttachmentBranch = orderLineFilesRoute.slice(deletedAttachmentBranchStart, deletedAttachmentBranchEnd);
    expect(deletedAttachmentBranch).not.toContain(".update(lineItemFiles)");
    expect(deletedAttachmentBranch).not.toContain(".set({ status: 'superseded' })");

    const assetUnlinkBranchStart = orderLineFilesRoute.indexOf("await assetRepository.unlinkAsset");
    const assetUnlinkBranchEnd = orderLineFilesRoute.indexOf("res.json({ success: true });", assetUnlinkBranchStart);
    const assetUnlinkBranch = orderLineFilesRoute.slice(assetUnlinkBranchStart, assetUnlinkBranchEnd);
    expect(assetUnlinkBranch).not.toContain(".update(lineItemFiles)");
    expect(assetUnlinkBranch).not.toContain(".set({ status: 'superseded' })");
  });

  test("metadata rows are only removed after actual storage deletion", () => {
    for (const source of [orderLineFilesRoute, orderRoute, quoteLineFilesRoute, attachmentRoute]) {
      expect(source).toContain("!derivativeDeletion.skipped && derivativeDeletion.failedKeys.length === 0");
      expect(source).toContain("derivativeDeletion.skipped || derivativeDeletion.failedKeys.length > 0");
    }
    expect(quoteLineFilesRoute).toContain("!pageDeletion.skipped && pageDeletion.failedKeys.length === 0");
    expect(attachmentRoute).toContain("!pageDeletion.skipped && pageDeletion.failedKeys.length === 0");
  });

});
