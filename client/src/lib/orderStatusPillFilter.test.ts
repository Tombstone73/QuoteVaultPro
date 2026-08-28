import {
  hideCompleteOrderStatusPill,
  orderStatusPillFilterLabel,
  orderStatusPillIdsForQuery,
  selectedOrderStatusPillIds,
  toggleOrderStatusPillId,
} from "./orderStatusPillFilter";

const pills = [
  { id: "ready", name: "Ready", key: "ready", isActive: true },
  { id: "progress", name: "In Progress", key: "in_progress", isActive: true },
  { id: "complete", name: "Complete", key: "complete", isActive: true },
  { id: "inactive", name: "Legacy", key: "legacy", isActive: false },
];

describe("order status pill multi-select filter", () => {
  it("treats the default and Select All as no unnecessary server filter", () => {
    expect(orderStatusPillIdsForQuery(null, pills)).toBeUndefined();
    expect(orderStatusPillIdsForQuery(["ready", "progress", "complete"], pills)).toBeUndefined();
    expect(selectedOrderStatusPillIds(null, pills)).toEqual(["ready", "progress", "complete"]);
  });

  it("deselects only Complete for the Hide Complete action", () => {
    const selection = hideCompleteOrderStatusPill(null, pills);
    expect(selection).toEqual(["ready", "progress"]);
    expect(orderStatusPillIdsForQuery(selection, pills)).toEqual(["ready", "progress"]);
    expect(orderStatusPillFilterLabel(selection, pills)).toBe("All except Complete");
  });

  it("supports explicit multiple includes and safe empty selection", () => {
    expect(orderStatusPillIdsForQuery(["ready", "complete"], pills)).toEqual(["ready", "complete"]);
    expect(orderStatusPillFilterLabel(["ready", "complete"], pills)).toBe("2 statuses");
    expect(orderStatusPillIdsForQuery([], pills)).toEqual([]);
    expect(orderStatusPillFilterLabel([], pills)).toBe("No Status Pills");
  });

  it("toggles from the all-status default without including inactive tenant pills", () => {
    expect(toggleOrderStatusPillId(null, "progress", pills)).toEqual(["ready", "complete"]);
  });
});
