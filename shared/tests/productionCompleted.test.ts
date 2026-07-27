import { describe, expect, test } from "@jest/globals";
import {
  completedProductionSearchText,
  describeCompletedArtworkSummary,
  resolveCompletedArtworkAllocations,
  resolveCompletedArtworkQuantityMode,
} from "../productionCompleted";

describe("completed production presentation", () => {
  test("keeps a six-design one-each allocation explicit", () => {
    const mode = resolveCompletedArtworkQuantityMode({ inbound: { artworkQuantityMode: "one_each_per_file" } });
    const result = resolveCompletedArtworkAllocations({ totalQuantity: 6, artworkCount: 6, quantityMode: mode });
    expect(result.allocationIssue).toBeNull();
    expect(result.allocations).toEqual(Array.from({ length: 6 }, () => ({ allocatedQuantity: 1 })));
    expect(describeCompletedArtworkSummary({ totalQuantity: 6, artworkCount: 6, quantityMode: mode, sides: ["front"] })).toBe("Quantity 6 • Front • 6 artwork files • 1 each");
  });

  test("reports mismatched one-each artwork instead of inventing allocations", () => {
    const result = resolveCompletedArtworkAllocations({ totalQuantity: 6, artworkCount: 2, quantityMode: "one_each_per_file" });
    expect(result.allocationIssue).toContain("expects 1 each");
    expect(result.allocations.map((entry) => entry.allocatedQuantity)).toEqual([null, null]);
  });

  test("search text includes exact line-item artwork and production identifiers", () => {
    const text = completedProductionSearchText({
      orderNumber: "SO-20009",
      customerName: "Acme Signs",
      itemName: "Coroplast Yard Signs",
      mediaName: "4mm Coroplast",
      dimensions: "24 × 18",
      artwork: [{ fileName: "design-six.pdf" }],
    });
    expect(text).toContain("design-six.pdf");
    expect(text).toContain("24 × 18");
  });
});
