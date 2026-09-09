import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Orders artwork download", () => {
  test("uses the canonical viewer download resolver after the list opens artwork directly", () => {
    const orders = source("client/src/pages/orders.tsx");
    const viewer = source("client/src/components/AttachmentViewerDialog.tsx");
    expect(orders).toContain("<AttachmentViewerDialog");
    expect(orders).not.toContain("openAttachmentsDialog");
    expect(viewer).toContain("resolveArtworkDownloadUrl(currentAttachment?.fileRecordId");
  });

  test("keeps viewer downloads on the same canonical resolver", () => {
    const viewer = source("client/src/components/AttachmentViewerDialog.tsx");
    expect(viewer).toContain("resolveArtworkDownloadUrl(currentAttachment?.fileRecordId");
    expect(viewer).toContain("void downloadFileFromUrl(downloadUrl, fileName)");
  });
});
