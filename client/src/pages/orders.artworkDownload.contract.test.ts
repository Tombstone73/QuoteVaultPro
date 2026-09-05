import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Orders artwork download", () => {
  test("resolves a canonical original file URL before requesting a direct Orders download", () => {
    const orders = source("client/src/pages/orders.tsx");
    expect(orders).toContain('import { resolveArtworkDownloadUrl } from "@/lib/artworkAccess"');
    expect(orders).toContain("resolveArtworkDownloadUrl(att?.fileRecordId, att?.downloadUrl, att?.originalUrl)");
    expect(orders).toContain("void downloadFileFromUrl(downloadUrl, filename)");
    expect(orders).not.toContain("const downloadUrl = att?.downloadUrl || att?.originalUrl || null");
  });

  test("keeps viewer downloads on the same canonical resolver", () => {
    const viewer = source("client/src/components/AttachmentViewerDialog.tsx");
    expect(viewer).toContain("resolveArtworkDownloadUrl(currentAttachment?.fileRecordId");
    expect(viewer).toContain("void downloadFileFromUrl(downloadUrl, fileName)");
  });
});
