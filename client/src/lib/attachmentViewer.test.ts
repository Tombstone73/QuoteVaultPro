import { describe, expect, test } from "@jest/globals";

import { toAttachmentViewerAttachment } from "./attachmentViewer";
import { isThumbTerminal } from './attachments/attachmentStatus';

test('new AI uploads continue bounded polling until a terminal preview result', () => {
  expect(isThumbTerminal({ fileName:'logo.ai', mimeType:'application/octet-stream', thumbStatus:'uploaded' })).toBe(false);
  expect(isThumbTerminal({ fileName:'logo.ai', thumbStatus:'thumb_failed' })).toBe(true);
  expect(isThumbTerminal({ fileName:'logo.ai', thumbStatus:'thumb_ready' })).toBe(true);
  expect(isThumbTerminal({ fileName:'photo.png', thumbStatus:'uploaded' })).toBe(true);
});

test('asset-only AI rows expose canonical ready and unsupported states to the shared viewer', () => {
  expect(toAttachmentViewerAttachment({id:'ai',fileName:'logo.ai',previewStatus:'ready'}).thumbStatus).toBe('thumb_ready');
  expect(toAttachmentViewerAttachment({id:'ai',fileName:'logo.ai',previewStatus:'failed',previewError:'preview_unsupported_postscript'})).toMatchObject({thumbStatus:'thumb_failed',thumbError:'preview_unsupported_postscript'});
});

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
