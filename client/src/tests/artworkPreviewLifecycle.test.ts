import { describe, expect, test } from "@jest/globals";

import { artworkPreviewLabel, shouldPollArtworkPreview } from "../lib/artworkPreviewLifecycle";

describe("artwork preview polling", () => {
  test("polls only active queued or processing previews", () => {
    expect(shouldPollArtworkPreview("queued")).toBe(true);
    expect(shouldPollArtworkPreview("processing")).toBe(true);
    expect(shouldPollArtworkPreview("available")).toBe(false);
    expect(shouldPollArtworkPreview("failed")).toBe(false);
    expect(shouldPollArtworkPreview("timed_out")).toBe(false);
  });

  test("uses terminal labels instead of presenting every missing PDF as generating", () => {
    expect(artworkPreviewLabel("timed_out")).toBe("Preview generation timed out");
    expect(artworkPreviewLabel("failed", "Preview generation failed. Retry preview to try again.")).toContain("failed");
  });
});
