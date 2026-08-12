import { describe, expect, test } from "@jest/globals";

import { toAttachmentViewerAttachment } from "./attachmentViewer";

describe("toAttachmentViewerAttachment", () => {
  test("preserves the canonical file-record identity for authenticated viewers", () => {
    const attachment = toAttachmentViewerAttachment({
      id: "order-attachment-1",
      fileRecordId: "file-record-1",
      fileName: "customer-art.pdf",
      fileUrl: "/objects/protected/customer-art.pdf",
    });

    expect(attachment.fileRecordId).toBe("file-record-1");
  });
});
