import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/apiConfig", () => ({
  objectsUrl: (value: string) => value,
  resolveObjectsPublicUrl: (value: string) => value,
}));

import { getLineItemThumbnailUrl } from "./lineItemThumbnailUrl";

describe("getLineItemThumbnailUrl", () => {
  test("uses the canonical derivative for an order line-item file record", () => {
    expect(getLineItemThumbnailUrl({
      fileRecordId: "file-record-1",
      thumbUrl: "/objects/legacy-thumbnail.jpg",
    })).toBe("/api/artwork/file-records/file-record-1/content?variant=thumbnail");
  });

  test("retains the existing compatibility thumbnail behavior without a file record", () => {
    expect(getLineItemThumbnailUrl({
      thumbUrl: "/objects/existing-thumbnail.jpg",
    })).toBe("/objects/existing-thumbnail.jpg");
  });
});
