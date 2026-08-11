import { buildPlannedProductionRunOutcomeMembers } from "../services/productionRunService";

describe("simplified combined-run completion policy", () => {
  test("one nested sheet printed many times completes from planned allocation without sheet progress", () => {
    const [member] = buildPlannedProductionRunOutcomeMembers([
      { id: "member-1", allocatedQuantity: 20, damagedQuantity: 0, operatorNote: null },
    ]);

    expect(member).toMatchObject({
      memberId: "member-1",
      successfulQuantity: 20,
      damagedQuantity: 0,
      remainingQuantity: 0,
      outcomeStatus: "completed",
      recoveryDisposition: "none",
    });
  });

  test("many nested sheets and many child items use each member allocation as authoritative success", () => {
    const members = buildPlannedProductionRunOutcomeMembers([
      { id: "member-a", allocatedQuantity: 1 },
      { id: "member-b", allocatedQuantity: 12 },
      { id: "member-c", allocatedQuantity: 7 },
    ], "Completed as planned from production board");

    expect(members.map((member) => member.successfulQuantity)).toEqual([1, 12, 7]);
    expect(members.every((member) => member.remainingQuantity === 0 && member.outcomeStatus === "completed")).toBe(true);
    expect(members.every((member) => member.operatorNote === "Completed as planned from production board")).toBe(true);
  });

  test("partial allocation completes only the run member quantity and leaves global completion to canonical production logic", () => {
    const [member] = buildPlannedProductionRunOutcomeMembers([
      { id: "member-partial", allocatedQuantity: 3 },
    ]);

    expect(member.successfulQuantity).toBe(3);
    expect(member.remainingQuantity).toBe(0);
  });
});
