import { describe, expect, test } from "@jest/globals";

import { getFulfillmentArtworkViewUrl } from "../lib/fulfillmentArtwork";

describe("fulfillment artwork urls", () => {
  test("uses server-provided preview/original/download urls before legacy fileUrl", () => {
    expect(getFulfillmentArtworkViewUrl({
      previewUrl: "/objects/previews/art.jpg",
      originalUrl: "/objects/originals/art.pdf",
      downloadUrl: "/objects/originals/art.pdf?download=1",
      fileUrl: "raw/storage/key.pdf",
    })).toBe("/objects/previews/art.jpg");

    expect(getFulfillmentArtworkViewUrl({
      originalUrl: "/objects/originals/art.pdf",
      downloadUrl: "/objects/originals/art.pdf?download=1",
      fileUrl: "raw/storage/key.pdf",
    })).toBe("/objects/originals/art.pdf");
  });

  test("does not open raw storage keys as routes", () => {
    expect(getFulfillmentArtworkViewUrl({ fileUrl: "uploads/org/art.pdf" })).toBeNull();
  });

  test("falls back to objectPath when only canonical object path exists", () => {
    expect(getFulfillmentArtworkViewUrl({ objectPath: "uploads/org/art.pdf" })).toBe("/objects/uploads/org/art.pdf");
  });
});
