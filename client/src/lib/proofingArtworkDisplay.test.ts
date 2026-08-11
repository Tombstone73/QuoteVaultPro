import { buildProofingArtworkDisplayUrl, buildProofingArtworkThumbnailUrl } from "./proofingArtworkDisplay";

describe("buildProofingArtworkDisplayUrl", () => {
  test("uses the authenticated canonical Proofing source route for line_item_files", () => {
    expect(buildProofingArtworkDisplayUrl("line item/1", {
      sourceType: "line_item_file",
      sourceId: "file/1",
    })).toBe("/api/proofing/line-item/line%20item%2F1/eligible-artwork/line_item_file/file%2F1/preview");
  });

  test("does not construct a route for missing source identity", () => {
    expect(buildProofingArtworkDisplayUrl("line-1", {
      sourceType: "line_item_artwork",
      sourceId: "",
    })).toBeNull();
  });

  test("requests thumbnails through the same authenticated source route", () => {
    expect(buildProofingArtworkThumbnailUrl("line-1", {
      sourceType: "line_item_artwork",
      sourceId: "artwork-1",
    })).toBe("/api/proofing/line-item/line-1/eligible-artwork/line_item_artwork/artwork-1/preview?variant=thumbnail");
  });
});
