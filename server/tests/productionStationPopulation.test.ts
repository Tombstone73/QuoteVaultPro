import { describe, expect, test, jest } from "@jest/globals";

jest.unstable_mockModule("../db", () => ({ db: {} }));
const { projectProductionStationWork, resolveProductionStationWork } = await import("../services/productionStationPopulation");
const { projectCanonicalProductionObligations } = await import("../services/orderProductionCompletionPolicy");
type Candidate = import("../services/productionStationPopulation").StationCandidate;
const job = (id: string, patch: Partial<Candidate> = {}): Candidate => ({
  jobId: id, lineItemId: `line-${id}`, stationKey: "flatbed", stepKey: "print", jobStatus: "queued",
  orderState: "open", orderStatus: "in_production", canceledAt: null,
  requiresProductionJob: true, workflowIntent: "standard_production", lineItemRole: "standalone",
  productionBypassed: false, workflowState: "ready_for_production", lifecycleStatus: "in_production", ...patch,
});
const project = (rows: Candidate[], members: { jobId: string; runId: string; stationKey: string }[] = [], station = "flatbed") =>
  projectProductionStationWork(rows, members, station);

describe("canonical station population", () => {
  test("active Flatbed owners without run membership remain countable and retrievable", () => {
    const result = project([job("queued"), job("started", { jobStatus: "in_progress" })]);
    expect([...result.jobIds]).toEqual(["queued", "started"]);
    expect(result.count).toBe(2);
  });
  test("no active work is zero", () => { expect(project([]).count).toBe(0); });
  test("mixed active and operationally complete Orders exclude only completed Orders", () => {
    const result = project([job("active"), job("closed", { orderStatus: "operationally_complete" })]);
    expect([...result.jobIds]).toEqual(["active"]); expect(result.count).toBe(1);
    expect(project([job("closed", { orderStatus: "operationally_complete" })]).count).toBe(0);
  });
  test.each([{ workflowState: "completed" }, { lifecycleStatus: "complete" }, { productionBypassed: true },
    { lineItemRole: "parent" }, { requiresProductionJob: false }, { workflowIntent: "service_fee" },
    { workflowIntent: "fulfillment_only" }, { jobStatus: "done" }, { orderState: "canceled" }])(
    "nonactionable line/job/Order is absent: %j", patch => {
      expect(project([job("excluded", patch)]).count).toBe(0);
    });
  test("one completed line does not remove a different obligation on its Order", () => {
    expect([...project([job("complete", { lifecycleStatus: "complete" }), job("remaining")]).jobIds]).toEqual(["remaining"]);
  });
  test("bootstrap remains a canonical obligation without inventing an owner", () => {
    const missing = job("missing");
    expect(projectCanonicalProductionObligations({ lines: [{ ...missing, id: missing.lineItemId }] })[0].state).toBe("needs_bootstrap");
    expect(project([]).count).toBe(0);
  });
  test("cross-station conflicting owners are surfaced without selecting or creating one", () => {
    const result = project([job("one"), job("two", { lineItemId: "line-one", stationKey: "roll" })]);
    expect(result.count).toBe(0);
    expect(result.issues).toEqual([{ jobId: "one", lineItemId: "line-one", reason: "Conflicting active production owners" }]);
  });
  test("missing canonical configuration produces staff diagnostics", () => {
    expect(project([job("bad", { requiresProductionJob: null })]).issues).toHaveLength(1);
  });
  test("Combined Run is one visible unit; terminal parents cannot keep its container active", () => {
    const result = project([job("a"), job("b"), job("c"), job("closed", { orderStatus: "operationally_complete" })], [
      { jobId: "a", runId: "run", stationKey: "flatbed" },
      { jobId: "b", runId: "run", stationKey: "flatbed" },
      { jobId: "closed", runId: "stale", stationKey: "flatbed" },
    ]);
    expect([...result.jobIds]).toEqual(["c"]); expect([...result.runIds]).toEqual(["run"]);
    expect(result.count).toBe(2); expect(result.count).toBe(result.jobIds.size + result.runIds.size);
  });
  test("Roll aliases and Prepress exclusion retain the same eligibility rules", () => {
    const rows = [job("flat"), job("roll", { stationKey: "wide_roll" }), job("prepress", { stepKey: "prepress" })];
    expect([...project(rows).jobIds]).toEqual(["flat"]);
    expect([...project(rows, [], "roll").jobIds]).toEqual(["roll"]);
  });
  test.each(["flat_bed", "sheet"])("legacy Flatbed alias %s uses canonical job identities", stationKey => {
    expect([...project([job("legacy", { stationKey })]).jobIds]).toEqual(["legacy"]);
  });
  test("resolver uses read-only queries and supplies identical identities to its consumers", async () => {
    const results = [[job("a"), job("b")], [{ jobId: "a", runId: "run", stationKey: "flatbed" }]];
    const executor: any = { select: jest.fn(() => {
      const query: any = { from: () => query, innerJoin: () => query, leftJoin: () => query, where: async () => results.shift() };
      return query;
    }) };
    const result = await resolveProductionStationWork("org", "flatbed", executor);
    expect([...result.jobIds]).toEqual(["b"]); expect([...result.runIds]).toEqual(["run"]); expect(result.count).toBe(2);
    expect(executor.select).toHaveBeenCalledTimes(2);
  });
});
