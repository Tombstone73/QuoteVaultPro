import { buildArtworkAllocationStatus, defaultSingleArtworkAllocation } from "../artworkAllocation";

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

  test("only defaults a single artwork to the full quantity", () => {
    expect(defaultSingleArtworkAllocation(10, 1)).toBe(10);
    expect(defaultSingleArtworkAllocation(10, 2)).toBeNull();
  });
});
