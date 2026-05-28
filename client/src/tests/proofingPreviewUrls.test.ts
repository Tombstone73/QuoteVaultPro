import { describe, expect, test } from "@jest/globals";

import {
  getStaffProofDownloadUrl,
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
});
