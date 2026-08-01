import {
  ACTIVE_PRODUCTION_RUN_STATUSES,
  isActiveProductionRunStatus,
  isUnfinishedProductionRunMember,
} from "../productionRunLifecycle";

describe("production run lifecycle visibility", () => {
  test("treats draft, released, started, and partial runs as active operational ownership", () => {
    expect(ACTIVE_PRODUCTION_RUN_STATUSES).toEqual([
      "draft",
      "ready_for_production",
      "in_production",
      "partially_completed",
    ]);
    expect(isActiveProductionRunStatus("canceled")).toBe(false);
    expect(isActiveProductionRunStatus("completed")).toBe(false);
  });

  test("does not suppress completed or canceled historical member work", () => {
    expect(isUnfinishedProductionRunMember({ allocatedQuantity: 8, completedQuantity: 8, remainingQuantity: 0 })).toBe(false);
    expect(isUnfinishedProductionRunMember({ allocatedQuantity: 8, successfulQuantity: 8, damagedQuantity: 0, remainingQuantity: 0 })).toBe(false);
  });

  test("keeps valid active run members hidden until their remaining work is resolved", () => {
    expect(isUnfinishedProductionRunMember({ allocatedQuantity: 8, completedQuantity: 0, remainingQuantity: 8 })).toBe(true);
    expect(isUnfinishedProductionRunMember({ allocatedQuantity: 8, successfulQuantity: 3, damagedQuantity: 1, remainingQuantity: 4 })).toBe(true);
  });
});
