import { groupRollProductionJobs, visibleRollQueueItems } from "./rollProductionGrouping";

function job(id: string, orderId: string, status: "queued" | "in_progress" | "paused", media: string, qty: number) {
  return {
    id, orderId, status, media, qty, jobDescription: `Artwork ${id}`,
    order: { id: orderId, orderNumber: orderId, customerName: `Customer ${orderId}` },
  } as any;
}

describe("roll production order groups", () => {
  test("keeps separate orders and single jobs while summarizing visible lines", () => {
    const rows = [job("a", "20949", "queued", "Avery 1105", 5), job("single", "20950", "queued", "Vinyl", 3), job("b", "20949", "in_progress", "Avery 1360", 7)];
    const grouped = groupRollProductionJobs(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ kind: "group", orderId: "20949", quantity: 12, materialSummary: "Mixed Materials", statuses: [{ status: "queued", count: 1 }, { status: "in_progress", count: 1 }] });
    if (grouped[0].kind === "group") expect(grouped[0].jobs.map((item) => item.id)).toEqual(["a", "b"]);
    expect(grouped[1]).toMatchObject({ kind: "job", job: { id: "single" } });
    expect(groupRollProductionJobs(rows.slice(0, 1))).toMatchObject([{ kind: "job", job: { id: "a" } }]);
  });

  test("never folds an active Combined Run into an order group", () => {
    const rows = [job("a", "20949", "queued", "Avery 1105", 5), { ...job("run", "20949", "queued", "", 10), kind: "production_run" }, job("b", "20949", "queued", "Avery 1105", 7)];
    const grouped = groupRollProductionJobs(rows);
    expect(grouped.map((item) => item.kind)).toEqual(["group", "job"]);
    if (grouped[0].kind === "group") expect(grouped[0].jobs.map((item) => item.id)).toEqual(["a", "b"]);
    if (grouped[1].kind === "job") expect(grouped[1].job.id).toBe("run");
  });

  test("collapse omits child rows and expansion restores their exact job identities", () => {
    const grouped = groupRollProductionJobs([job("a", "20949", "queued", "Avery", 5), job("b", "20949", "queued", "Avery", 7)]);
    expect(visibleRollQueueItems(grouped, new Set()).map((item) => item.kind)).toEqual(["group"]);
    expect(visibleRollQueueItems(grouped, new Set(["20949"])).map((item) => item.kind === "job" ? item.job.id : item.orderId)).toEqual(["20949", "a", "b"]);
  });
});
