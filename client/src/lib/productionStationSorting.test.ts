import type { ProductionJobListItem } from "@/hooks/useProduction";
import {
  nextProductionStationSort,
  persistProductionStationSort,
  productionStationPoJob,
  productionStationSortStorageKey,
  readProductionStationSort,
  sortProductionStationJobs,
  type ProductionStationSort,
} from "./productionStationSorting";

const job = (id: string, overrides: Record<string, unknown> = {}): ProductionJobListItem => ({
  id, kind: "production_job", view: "roll", status: "queued", lineItemId: `line-${id}`,
  startedAt: null, completedAt: null, totalSeconds: 0, reprintCount: 0,
  timer: { isRunning: false, runningSince: null, currentSeconds: 0 },
  createdAt: "2026-09-01", updatedAt: "2026-09-01",
  order: { id: `order-${id}`, customerId: "customer", orderNumber: id, customerName: id, dueDate: null, priority: "normal", lineItems: { count: 1, totalQuantity: 1, primary: null, items: [] } },
  ...overrides,
} as ProductionJobListItem);

const sortedIds = (jobs: ProductionJobListItem[], sort: ProductionStationSort) => sortProductionStationJobs(jobs, sort).map((item) => item.id);

describe("production station sorting", () => {
  const jobs = [
    job("2000", { order: { id: "o2000", customerId: "c", orderNumber: "2000", customerName: "zebra", dueDate: "2026-10-03", priority: "normal", poNumber: "PO-B", lineItems: { count: 1, totalQuantity: 20, primary: null, items: [] } } }),
    job("201", { order: { id: "o201", customerId: "c", orderNumber: "201", customerName: "Alpha", dueDate: "2026-10-01", priority: "normal", poNumber: "PO-A", lineItems: { count: 1, totalQuantity: 3, primary: null, items: [] } } }),
    job("21", { order: { id: "o21", customerId: "c", orderNumber: "21", customerName: "beta", dueDate: null, priority: "normal", lineItems: { count: 1, totalQuantity: 8, primary: null, items: [] } }, jobDescription: "Job C" }),
    job("200", { order: { id: "o200", customerId: "c", orderNumber: "200", customerName: "alpha", dueDate: "2026-10-01", priority: "normal", lineItems: { count: 1, totalQuantity: 2, primary: null, items: [] } }, jobDescription: "Job A" }),
  ];

  test("preserves incoming run-then-job order when no sort is selected", () => {
    expect(sortProductionStationJobs(jobs, null)).toEqual(jobs);
    expect(sortProductionStationJobs(jobs, { field: "order", direction: "asc" })).not.toBe(jobs);
  });

  test("Due sorts chronologically both ways with null last and numeric Order tie-break", () => {
    expect(sortedIds(jobs, { field: "due", direction: "asc" })).toEqual(["200", "201", "2000", "21"]);
    expect(sortedIds(jobs, { field: "due", direction: "desc" })).toEqual(["2000", "200", "201", "21"]);
  });

  test("Order uses numeric ordering and Customer is case-insensitive", () => {
    expect(sortedIds(jobs, { field: "order", direction: "asc" })).toEqual(["21", "200", "201", "2000"]);
    expect(sortedIds(jobs, { field: "customer", direction: "asc" })).toEqual(["200", "201", "21", "2000"]);
  });

  test("PO / Job sorts its visible primary value and Qty is numeric", () => {
    expect(productionStationPoJob(jobs[0])).toMatchObject({ po: "PO-B", sortValue: "PO-B" });
    expect(productionStationPoJob(jobs[2])).toMatchObject({ po: null, sortValue: "Job C" });
    expect(sortedIds(jobs, { field: "poJob", direction: "asc" })).toEqual(["200", "21", "201", "2000"]);
    expect(sortedIds(jobs, { field: "qty", direction: "asc" })).toEqual(["200", "201", "21", "2000"]);
  });

  test("equal values fall back to Order then canonical work id, including multiple units for one Order", () => {
    const sameOrder = [job("work-b", { order: { ...jobs[0].order, orderNumber: "200" } }), job("work-a", { order: { ...jobs[0].order, orderNumber: "200" } })];
    expect(sortedIds(sameOrder, { field: "customer", direction: "desc" })).toEqual(["work-a", "work-b"]);
  });

  test("Combined Runs remain in the set and sort safely when Due is absent", () => {
    const run = job("run-1", { kind: "production_run", runStatus: "in_production", jobDescription: "RUN-7 combined production run", order: { ...jobs[0].order, orderNumber: "300", dueDate: null, lineItems: { count: 2, totalQuantity: 12, primary: null, items: [] } } });
    expect(sortedIds([run, ...jobs], { field: "due", direction: "asc" })).toContain("run-1");
    expect(sortedIds([run, ...jobs], { field: "qty", direction: "asc" })).toEqual(["200", "201", "21", "run-1", "2000"]);
    expect(sortedIds([run, ...jobs], { field: "status", direction: "asc" })).toContain("run-1");
  });

  test("filtering and a refetched array retain the same selected sort without changing inputs", () => {
    const sort = { field: "customer", direction: "asc" } as const;
    const filtered = jobs.filter((item) => item.order.dueDate);
    expect(sortedIds(filtered, sort)).toEqual(["200", "201", "2000"]);
    expect(sortedIds([...jobs], sort)).toEqual(sortedIds(jobs, sort));
    expect(jobs.map((item) => item.id)).toEqual(["2000", "201", "21", "200"]);
  });

  test("header toggles ascending then descending", () => {
    expect(nextProductionStationSort(null, "due")).toEqual({ field: "due", direction: "asc" });
    expect(nextProductionStationSort({ field: "due", direction: "asc" }, "due")).toEqual({ field: "due", direction: "desc" });
    expect(nextProductionStationSort({ field: "due", direction: "desc" }, "customer")).toEqual({ field: "customer", direction: "asc" });
  });

  test("per-user Roll and Flatbed preferences restore independently and corrupt values fail softly", () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    persistProductionStationSort("roll", "user-a", { field: "customer", direction: "asc" }, storage);
    persistProductionStationSort("flatbed", "user-a", { field: "due", direction: "asc" }, storage);
    expect(readProductionStationSort("roll", "user-a", storage)).toEqual({ field: "customer", direction: "asc" });
    expect(readProductionStationSort("flatbed", "user-a", storage)).toEqual({ field: "due", direction: "asc" });
    expect(readProductionStationSort("roll", "user-b", storage)).toBeNull();
    entries.set(productionStationSortStorageKey("roll", "user-a"), "{broken");
    expect(readProductionStationSort("roll", "user-a", storage)).toBeNull();
    entries.set(productionStationSortStorageKey("roll", "user-a"), '{"field":"old-column","direction":"up"}');
    expect(readProductionStationSort("roll", "user-a", storage)).toBeNull();
  });
});
