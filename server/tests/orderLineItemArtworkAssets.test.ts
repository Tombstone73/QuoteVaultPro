import { describe, expect, test } from "@jest/globals";

import { buildOrderLineItemArtworkAssetsResponse } from "../services/orderLineItemArtworkAssets";

describe("order line-item Artwork Assets response", () => {
  test("returns each attachment and asset relationship at most once", () => {
    const response = buildOrderLineItemArtworkAssetsResponse(
      [
        { id: "attachment-1", fileRecordId: "file-record-1" },
        { id: "attachment-1", fileRecordId: "file-record-1" },
      ],
      [
        { id: "asset-1", fileRecordId: "file-record-1" },
        { id: "asset-1", fileRecordId: "file-record-1" },
      ],
    );

    expect(response.data).toEqual([{ id: "attachment-1", fileRecordId: "file-record-1" }]);
    expect(response.assets).toEqual([{ id: "asset-1", fileRecordId: "file-record-1" }]);
  });

  test("keeps distinct relationships even when their filenames or file content would match", () => {
    const response = buildOrderLineItemArtworkAssetsResponse(
      [
        { id: "attachment-1", fileRecordId: "file-record-1", fileName: "art.pdf" },
        { id: "attachment-2", fileRecordId: "file-record-2", fileName: "art.pdf" },
      ],
      [],
    );

    expect(response.data).toHaveLength(2);
  });
});
