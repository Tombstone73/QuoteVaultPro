import {
  buildArtworkAllocationStatus,
  defaultNewProductionArtworkAllocation,
  defaultProductionArtworkAllocationForLine,
  reconcileStagedArtworkAllocations,
} from "../artworkAllocation";

describe("artwork allocation", () => {
  test("keeps uneven alternatives as a line-item total", () => {
    const result = buildArtworkAllocationStatus({ lineQuantity: 20, members: [
      { id: "english", productionQuantity: 12 }, { id: "spanish", productionQuantity: 8 },
    ] });
    expect(result).toMatchObject({ allocatedTotal: 20, valid: true, issue: null });
  });

  test("does not double count front and back in one explicit production group", () => {
    const result = buildArtworkAllocationStatus({ lineQuantity: 20, members: [
      { id: "english-front", side: "front", productionGroupId: "english", productionQuantity: 12 },
      { id: "english-back", side: "back", productionGroupId: "english", productionQuantity: 12 },
      { id: "spanish-front", side: "front", productionGroupId: "spanish", productionQuantity: 8 },
      { id: "spanish-back", side: "back", productionGroupId: "spanish", productionQuantity: 8 },
    ] });
    expect(result).toMatchObject({ allocatedTotal: 20, valid: true, groups: [{ id: "english", quantity: 12 }, { id: "spanish", quantity: 8 }] });
  });

  test("does not allocate reference files and detects incomplete work", () => {
    const result = buildArtworkAllocationStatus({ lineQuantity: 10, members: [
      { id: "final", productionQuantity: 7 }, { id: "instructions", role: "reference", productionQuantity: null },
    ] });
    expect(result.allocatedTotal).toBe(7);
    expect(result.issue).toContain("Assign 3 more");
  });

  test("defaults each new production artwork relationship to one finished piece", () => {
    expect(defaultNewProductionArtworkAllocation("artwork")).toBe(1);
    expect(defaultNewProductionArtworkAllocation("final")).toBe(1);
    expect(defaultNewProductionArtworkAllocation("output")).toBe(1);
    expect(defaultNewProductionArtworkAllocation("reference")).toBeNull();
    expect(defaultNewProductionArtworkAllocation("proof")).toBeNull();
  });

  test("defaults a single production artwork to the full line quantity", () => {
    expect(defaultProductionArtworkAllocationForLine({ role: "final", lineQuantity: 50, existingProductionArtworkCount: 0 })).toBe(50);
  });

  test("defaults one each only when the line quantity equals the resulting artwork count", () => {
    expect(defaultProductionArtworkAllocationForLine({ role: "final", lineQuantity: 2, existingProductionArtworkCount: 1 })).toBe(1);
    expect(defaultProductionArtworkAllocationForLine({ role: "final", lineQuantity: 50, existingProductionArtworkCount: 1 })).toBeNull();
  });

  test("keeps a sole staged artwork aligned to the line quantity until staff edits it", () => {
    const initial = reconcileStagedArtworkAllocations({
      lineQuantity: 4,
      attachments: [{ uploadId: "art-1" }],
    });
    expect(initial).toEqual([{ uploadId: "art-1", productionQuantity: 4, allocationSource: "automatic" }]);

    const resized = reconcileStagedArtworkAllocations({ lineQuantity: 6, attachments: initial });
    expect(resized[0]).toMatchObject({ productionQuantity: 6, allocationSource: "automatic" });

    const manual = [{ ...resized[0], productionQuantity: 2, allocationSource: "manual" as const }];
    expect(reconcileStagedArtworkAllocations({ lineQuantity: 8, attachments: manual })[0])
      .toMatchObject({ productionQuantity: 2, allocationSource: "manual" });
  });

  test("defaults multiple staged artworks only when one each is unambiguous", () => {
    const matched = reconcileStagedArtworkAllocations({
      lineQuantity: 2,
      attachments: [{ uploadId: "art-1" }, { uploadId: "art-2" }],
    });
    expect(matched.map((attachment) => attachment.productionQuantity)).toEqual([1, 1]);

    const unresolved = reconcileStagedArtworkAllocations({
      lineQuantity: 4,
      attachments: [{ uploadId: "art-1" }, { uploadId: "art-2" }],
    });
    expect(unresolved.map((attachment) => attachment.productionQuantity)).toEqual([null, null]);
  });
});
