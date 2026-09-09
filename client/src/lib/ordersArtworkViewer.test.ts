import { describe, expect, test } from "@jest/globals";
import { resolveOrdersArtworkViewerIndex } from "./ordersArtworkViewer";

const attachments: any[] = [
  { id: "attachment-a", fileRecordId: "file-a", thumbUrl: "/api/artwork/file-records/file-a/content?variant=thumbnail" },
  { id: "attachment-b", fileRecordId: "file-b", thumbUrl: "/api/artwork/file-records/file-b/content?variant=thumbnail" },
];

describe("resolveOrdersArtworkViewerIndex", () => {
  test("opens the exact attachment selected by a thumbnail", () => {
    expect(resolveOrdersArtworkViewerIndex(attachments, { attachmentId: "attachment-b" })).toBe(1);
    expect(resolveOrdersArtworkViewerIndex(attachments, {
      thumbnailUrl: "/api/artwork/file-records/file-a/content?variant=thumbnail",
    })).toBe(0);
  });

  test("handles signed/cross-origin thumbnail URLs and missing artwork safely", () => {
    expect(resolveOrdersArtworkViewerIndex(attachments, {
      thumbnailUrl: "https://example.test/api/artwork/file-records/file-b/content?variant=thumbnail&signature=old-token",
    })).toBe(1);
    expect(resolveOrdersArtworkViewerIndex([], { attachmentId: "missing" })).toBe(0);
    expect(resolveOrdersArtworkViewerIndex(attachments, { attachmentId: "missing" })).toBe(0);
  });
});
