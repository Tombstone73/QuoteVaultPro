import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductionStationErrorBoundary } from "./ProductionStationErrorBoundary";
import { productionRunMatchesSearch, productionRunToBoardItem } from "@/lib/productionRuns";
import { getProductionTabCounts, filterProductionJobsForTab } from "@/lib/productionBoard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const run: any = { kind: "production_run", id: "run", displayNumber: "RUN-100", status: "queued", stationKey: "flatbed",
  customerName: null, orderId: null, orderNumber: null, files: [], members: [{ orderLineItemId: "line", description: "Sign", orderNumber: "20222" }], memberCount: 1, totalAllocatedQuantity: 1 };

test("null display data and grouped member search preserve the run container", () => {
  const item = productionRunToBoardItem(run);
  expect(item.id).toBe("run"); expect(item.order.lineItems.primary.description).toBe("Sign");
  expect(productionRunMatchesSearch(run, "20222")).toBe(true);
  expect(productionRunMatchesSearch(run, "RUN-100")).toBe(true);
  expect(productionRunMatchesSearch(run, "kdw")).toBe(false);
  expect(productionRunMatchesSearch(run, " ")).toBe(true);
  const items = [item, { id: "standalone", status: "in_progress" }];
  expect(getProductionTabCounts(items).all).toBe(filterProductionJobsForTab(items, "all").length);
  expect(filterProductionJobsForTab(items, "queued").map(item => item.id)).toEqual(["run"]);
});

test("unexpected malformed rendering produces a staff alert and diagnostic context, with retry", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div"); const root = createRoot(container);
  let fail = true;
  function Record() { if (fail) throw new Error("Malformed record"); return <p>Job restored</p>; }
  try {
    act(() => root.render(<ProductionStationErrorBoundary station="flatbed" workIds={["bad-job"]}><Record /></ProductionStationErrorBoundary>));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("queue is not confirmed empty");
    expect(spy).toHaveBeenCalledWith("[production-station] render failed", expect.objectContaining({ station: "flatbed", workIds: ["bad-job"] }));
    fail = false; act(() => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Job restored");
  } finally { act(() => root.unmount()); spy.mockRestore(); }
});
