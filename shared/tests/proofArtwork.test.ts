import { describe, expect, test } from "@jest/globals";
import { resolveProofArtworkLayout } from "../proofArtwork";

describe("resolveProofArtworkLayout", () => {
  test("uses one Artwork panel for a single-sided line", () => {
    const result = resolveProofArtworkLayout({
      printSides: "Single-sided",
      sources: [{ id: "art", side: "na" }],
      useSameArtworkBothSides: false,
    });
    expect(result).toMatchObject({ complete: true, sameArtworkBothSides: false });
    expect(result.panels).toEqual([{ label: "Artwork", source: { id: "art", side: "na" } }]);
  });

  test("uses one explicit shared panel for same artwork on both sides", () => {
    const result = resolveProofArtworkLayout({
      printSides: "Double-sided",
      sources: [{ id: "shared", side: "both" }],
      useSameArtworkBothSides: true,
    });
    expect(result).toMatchObject({ complete: true, sameArtworkBothSides: true });
    expect(result.panels[0].source?.id).toBe("shared");
  });

  test("uses the sole unassigned file when same-artwork intent makes it unambiguous", () => {
    const result = resolveProofArtworkLayout({
      printSides: "Double-sided",
      sources: [{ id: "sole-artwork", side: "na" }],
      useSameArtworkBothSides: true,
    });
    expect(result).toMatchObject({ complete: true, sameArtworkBothSides: true });
    expect(result.panels[0].source?.id).toBe("sole-artwork");
  });

  test("uses the saved stable file id when multiple files are attached for both sides", () => {
    const result = resolveProofArtworkLayout({
      printSides: "Double-sided",
      sources: [{ id: "first", side: "na" }, { id: "chosen", side: "na" }],
      useSameArtworkBothSides: true,
      sameArtworkFileId: "chosen",
    });
    expect(result).toMatchObject({ complete: true, sameArtworkBothSides: true });
    expect(result.panels[0].source?.id).toBe("chosen");
  });

  test("uses separate Front and Back panels from stable assignments", () => {
    const result = resolveProofArtworkLayout({
      printSides: "Double-sided",
      sources: [{ id: "back", side: "back" }, { id: "front", side: "front" }],
      useSameArtworkBothSides: false,
    });
    expect(result.panels.map((panel) => [panel.label, panel.source?.id])).toEqual([
      ["Front", "front"],
      ["Back", "back"],
    ]);
  });

  test("fails closed when a double-sided line is missing Back artwork", () => {
    const result = resolveProofArtworkLayout({
      printSides: "Double-sided",
      sources: [{ id: "front", side: "front" }],
      useSameArtworkBothSides: false,
    });
    expect(result).toMatchObject({ complete: false, warning: "Back artwork not assigned." });
  });
});
