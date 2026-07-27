import { describe, expect, test } from "@jest/globals";

import {
  getStaffProofDownloadUrl,
  getStaffArtworkThumbnailUrl,
  getStaffProofPreviewUrl,
  normalizeStaffProofFileUrl,
  shouldFetchStaffPreviewAsBlob,
} from "../lib/proofingPreviewUrls";

describe("proofing preview urls", () => {
  test("rewrites absolute object proxy urls to same-origin paths for staff auth", () => {
    expect(normalizeStaffProofFileUrl("https://api.dev.example.com/objects/uploads/proof.png?filename=proof.png"))
      .toBe("/objects/uploads/proof.png?filename=proof.png");
  });

  test("keeps external signed urls intact", () => {
    expect(normalizeStaffProofFileUrl("https://storage.example.com/private/signed-proof.png?sig=abc"))
      .toBe("https://storage.example.com/private/signed-proof.png?sig=abc");
  });

  test("uses credentialed blob fetch for same-origin proof previews", () => {
    expect(shouldFetchStaffPreviewAsBlob("/objects/uploads/proof.png")).toBe(true);
    expect(shouldFetchStaffPreviewAsBlob("https://storage.example.com/proof.png")).toBe(false);
  });

  test("resolves staff preview and download urls from server-provided fields", () => {
    const file = {
      originalUrl: "https://api.dev.example.com/objects/uploads/proof.png",
      downloadUrl: "https://api.dev.example.com/objects/uploads/proof.png?download=1",
    };

    expect(getStaffProofPreviewUrl(file, false)).toBe("/objects/uploads/proof.png");
    expect(getStaffProofDownloadUrl(file)).toBe("/objects/uploads/proof.png?download=1");
  });

  test("never supplies a raw PDF as an artwork image source", () => {
    expect(getStaffArtworkThumbnailUrl({ originalUrl: "/objects/artwork.pdf", mimeType: "application/pdf" }, true)).toBeNull();
    expect(getStaffArtworkThumbnailUrl({ originalUrl: "/objects/artwork.pdf", thumbUrl: "/objects/artwork.thumb.jpg" }, true))
      .toBe("/objects/artwork.thumb.jpg");
  });

  test("keeps an authenticated original image as a valid artwork preview fallback", () => {
    expect(getStaffArtworkThumbnailUrl({ originalUrl: "/objects/artwork.png", mimeType: "image/png" }, false))
      .toBe("/objects/artwork.png");
  });
});
