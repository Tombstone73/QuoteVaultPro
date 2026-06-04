import { describe, expect, it } from "@jest/globals";

import { movePlanningItem, sortPlanningItems, toSequentialPlanningOrder } from "./productPlanningBoard";

describe("productPlanningBoard helpers", () => {
  const items = [
    { id: "later", createdAt: "2026-01-03T00:00:00.000Z", sortOrder: null, roadmapOrder: 30 },
    { id: "middle", createdAt: "2026-01-02T00:00:00.000Z", sortOrder: 20, roadmapOrder: 20 },
    { id: "first", createdAt: "2026-01-01T00:00:00.000Z", sortOrder: 10, roadmapOrder: null },
  ];

  it("sorts explicit order before unordered fallback rows", () => {
    expect(sortPlanningItems(items, "sortOrder").map((item) => item.id)).toEqual(["first", "middle", "later"]);
  });

  it("moves one item without dropping neighbors", () => {
    expect(movePlanningItem(items, "middle", -1).map((item) => item.id)).toEqual(["middle", "later", "first"]);
  });

  it("keeps order unchanged for impossible moves", () => {
    expect(movePlanningItem(items, "missing", 1)).toBe(items);
    expect(movePlanningItem(items, "later", -1)).toBe(items);
  });

  it("assigns stable sequential sort order values", () => {
    expect(toSequentialPlanningOrder(items, "sortOrder")).toEqual([
      { id: "later", sortOrder: 10 },
      { id: "middle", sortOrder: 20 },
      { id: "first", sortOrder: 30 },
    ]);
  });
});
