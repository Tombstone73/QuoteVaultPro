import {
  buildArtworkAllocationStatus,
  defaultNewProductionArtworkAllocation,
  defaultProductionArtworkAllocationForLine,
  getSafeArtworkAllocationDefaults,
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

  test("counts two required artwork layers as one 250-piece finished output", () => {
    const result = buildArtworkAllocationStatus({ lineQuantity: 250, members: [
      { id: "color", productionGroupId: "window-cling-a", productionQuantity: 250 },
      { id: "white", productionGroupId: "window-cling-a", productionQuantity: 250 },
    ] });
    expect(result).toMatchObject({ allocatedTotal: 250, valid: true, groups: [{ id: "window-cling-a", quantity: 250 }] });
  });

  test("counts mixed multilayer designs by output-group quantity rather than layer count", () => {
    const result = buildArtworkAllocationStatus({ lineQuantity: 250, members: [
      { id: "a-color", productionGroupId: "design-a", productionQuantity: 150 },
      { id: "a-white", productionGroupId: "design-a", productionQuantity: 150 },
      { id: "b-color", productionGroupId: "design-b", productionQuantity: 100 },
      { id: "b-white", productionGroupId: "design-b", productionQuantity: 100 },
    ] });
    expect(result).toMatchObject({ allocatedTotal: 250, valid: true });
  });

  test("rejects a multilayer set whose member quantities disagree", () => {
    const result = buildArtworkAllocationStatus({ lineQuantity: 250, members: [
      { id: "color", productionGroupId: "window-cling-a", productionQuantity: 250 },
      { id: "white", productionGroupId: "window-cling-a", productionQuantity: 1 },
    ] });
    expect(result.valid).toBe(false);
    expect(result.issue).toContain("inconsistent within an output group");
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

  test("preserves manually grouped staged layers when reconciling a line quantity", () => {
    const grouped = reconcileStagedArtworkAllocations({
      lineQuantity: 250,
      attachments: [
        { uploadId: "color", productionGroupId: "window-cling-a", productionQuantity: 250, allocationSource: "manual" as const },
        { uploadId: "white", productionGroupId: "window-cling-a", productionQuantity: 250, allocationSource: "manual" as const },
      ],
    });
    expect(grouped).toEqual(expect.arrayContaining([
      expect.objectContaining({ productionGroupId: "window-cling-a", productionQuantity: 250 }),
    ]));
    expect(buildArtworkAllocationStatus({ lineQuantity: 250, members: grouped.map((file) => ({ id: file.uploadId, productionQuantity: file.productionQuantity, productionGroupId: file.productionGroupId })) })).toMatchObject({ valid: true, allocatedTotal: 250 });
  });

  test("repairs one unresolved final output group to the full line quantity", () => {
    expect(getSafeArtworkAllocationDefaults({
      lineQuantity: 25,
      members: [{ id: "final", role: "final", productionQuantity: null }],
    })).toEqual([{ id: "final", productionQuantity: 25 }]);
  });

  test("repairs separate unresolved designs one each only when their count matches the line quantity", () => {
    expect(getSafeArtworkAllocationDefaults({
      lineQuantity: 2,
      members: [
        { id: "design-a", role: "final", productionQuantity: null },
        { id: "design-b", role: "final", productionQuantity: null },
      ],
    })).toEqual([
      { id: "design-a", productionQuantity: 1 },
      { id: "design-b", productionQuantity: 1 },
    ]);
  });

  test("does not mistake unresolved front and back files for two separate designs", () => {
    expect(getSafeArtworkAllocationDefaults({
      lineQuantity: 2,
      members: [
        { id: "front", role: "final", side: "front", productionQuantity: null },
        { id: "back", role: "final", side: "back", productionQuantity: null },
      ],
    })).toEqual([]);
  });

  test("does not overwrite a partially allocated final-artwork distribution", () => {
    expect(getSafeArtworkAllocationDefaults({
      lineQuantity: 20,
      members: [
        { id: "english", role: "final", productionQuantity: 12 },
        { id: "spanish", role: "final", productionQuantity: null },
      ],
    })).toEqual([]);
  });
});
