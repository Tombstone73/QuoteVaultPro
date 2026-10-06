import { canReadWorkValue } from "@shared/workValueAccess";
import { READY_TO_FINALIZE_JOB_STATUSES, READY_TO_FINALIZE_SEND_STATUS } from "@shared/invoiceReadyToFinalize";
import { projectActiveProductionValueContributions, type ActiveProductionValueLine } from "../lib/activeProductionValue";
import { buildWorkValueSummary, centsSummary, filterActiveWorkValueRows, groupActiveOrderRows, workValueDueWindow, type WorkValueFilters, type WorkValueRow } from "../lib/workValueProjection";

const now = new Date("2026-10-06T16:00:00Z");
const filters = (overrides: Partial<WorkValueFilters> = {}): WorkValueFilters => ({ status: "active_production", duePreset: "all", page: 1, ...overrides });
const row = (overrides: Partial<WorkValueRow> = {}): WorkValueRow => ({
  id: "order-1", kind: "order", status: "New", orderId: "order-1", orderNumber: "20001",
  lineDescription: "Window graphics", customerId: "customer-1", customerName: "Brainstorm Print",
  poNumber: "PO-123", jobLabel: "Front lobby", dueDate: "2026-10-06T12:00:00Z",
  invoiceId: null, invoiceNumber: null, valueCents: 10_000, ...overrides,
});
const line = (overrides: Partial<ActiveProductionValueLine> = {}): ActiveProductionValueLine => ({
  id: "line-1", orderId: "order-1", organizationId: "org-1", orderState: "open", orderStatus: "new",
  orderCanceledAt: null, statusPillId: "pill-new", statusPillKey: "new", statusPillValue: "New",
  workflowState: "new", lifecycleStatus: "new", lineItemRole: "standalone", parentLineItemId: null,
  parentPriceMode: "sum_children", valueCents: 10_000, ...overrides,
});

describe("Work Value canonical records", () => {
  test("New and In Production enter Active Production once, and Complete leaves on refetch", () => {
    const initial = projectActiveProductionValueContributions("org-1", [
      line(),
      line({ id: "line-2", orderId: "order-2", statusPillId: "pill-production", statusPillKey: "in_production", statusPillValue: "In Production", valueCents: 20_000 }),
    ]);
    expect(initial.map((entry) => [entry.bucket, entry.valueCents])).toEqual([["new", 10_000], ["in_production", 20_000]]);
    expect(initial.reduce((sum, entry) => sum + entry.valueCents, 0)).toBe(30_000);
    const afterComplete = projectActiveProductionValueContributions("org-1", [
      line(),
      line({ id: "line-2", orderId: "order-2", statusPillId: "pill-complete", statusPillKey: "complete", statusPillValue: "Complete", valueCents: 20_000 }),
    ]);
    expect(afterComplete).toHaveLength(1);
    expect(afterComplete[0].valueCents).toBe(10_000);
  });

  test("bundle parent and Combined Run representations cannot multiply one selling value", () => {
    const contributions = projectActiveProductionValueContributions("org-1", [
      line({ id: "parent", lineItemRole: "parent", parentPriceMode: "manual_override", valueCents: 50_000 }),
      line({ id: "child-a", lineItemRole: "child", parentLineItemId: "parent", valueCents: 20_000 }),
      line({ id: "child-b", lineItemRole: "child", parentLineItemId: "parent", valueCents: 20_000 }),
      line({ id: "other-org", organizationId: "org-2", valueCents: 90_000 }),
    ]);
    expect(contributions).toEqual([{ lineId: "parent", orderId: "order-1", parentLineItemId: null, bucket: "new", valueCents: 50_000 }]);
  });

  test("status, customer, due date, and search compose on the same records", () => {
    const rows = [
      row({ id: "a", dueDate: "2026-10-05T12:00:00Z", valueCents: 5_000 }),
      row({ id: "b", status: "In Production", dueDate: "2026-10-06T12:00:00Z", valueCents: 6_000 }),
      row({ id: "c", customerId: "customer-2", dueDate: "2026-10-08T12:00:00Z", valueCents: 7_000 }),
    ];
    expect(filterActiveWorkValueRows(rows, filters({ status: "new" }), now, "UTC").map((item) => item.id)).toEqual(["a", "c"]);
    expect(filterActiveWorkValueRows(rows, filters({ status: "in_production" }), now, "UTC").map((item) => item.id)).toEqual(["b"]);
    expect(filterActiveWorkValueRows(rows, filters({ customerId: "customer-1", duePreset: "overdue", search: "PO-123" }), now, "UTC").map((item) => item.id)).toEqual(["a"]);
    expect(filterActiveWorkValueRows(rows, filters({ duePreset: "this_week", customerId: "customer-1", search: "lobby" }), now, "UTC").map((item) => item.id)).toEqual(["a", "b"]);
    const filtered = filterActiveWorkValueRows(rows, filters({ customerId: "customer-1" }), now, "UTC");
    expect(centsSummary(filtered)).toEqual({ count: 2, valueCents: 11_000 });
  });

  test("summary cards and filtered value reconcile to their displayed canonical records", () => {
    const rows = [row({ id: "new", valueCents: 1_001 }), row({ id: "production", status: "In Production", valueCents: 2_002 })];
    expect(buildWorkValueSummary(rows, { count: 1, valueCents: 5_000 })).toEqual({
      active_production: { count: 2, valueCents: 3_003 },
      new: { count: 1, valueCents: 1_001 },
      in_production: { count: 1, valueCents: 2_002 },
      complete_not_sent: { count: 1, valueCents: 5_000 },
    });
    expect(centsSummary(filterActiveWorkValueRows(rows, filters({ status: "new" }), now, "UTC"))).toEqual({ count: 1, valueCents: 1_001 });
  });

  test("multiple billable lines contribute to one Order row and one Order count", () => {
    const grouped = groupActiveOrderRows([
      row({ id: "line-a", valueCents: 10_000 }),
      row({ id: "line-b", valueCents: 20_000 }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ id: "order-1", valueCents: 30_000, status: "New" });
    expect(centsSummary(grouped)).toEqual({ count: 1, valueCents: 30_000 });
  });

  test("date presets and custom inclusive end resolve to bounded business dates", () => {
    expect(workValueDueWindow(filters({ duePreset: "today" }), now, "UTC")).toEqual({ from: "2026-10-06", toExclusive: "2026-10-07" });
    expect(workValueDueWindow(filters({ duePreset: "tomorrow" }), now, "UTC")).toEqual({ from: "2026-10-07", toExclusive: "2026-10-08" });
    expect(workValueDueWindow(filters({ duePreset: "custom", dateFrom: "2026-10-05", dateTo: "2026-10-08" }), now, "UTC")).toEqual({ from: "2026-10-05", toExclusive: "2026-10-09" });
  });

  test("Ready to Finalize reuses the exact Invoice filter keys", () => {
    expect(READY_TO_FINALIZE_JOB_STATUSES).toEqual(["job_complete", "fulfillment_complete"]);
    expect(READY_TO_FINALIZE_SEND_STATUS).toBe("never_sent");
  });

  test("the established finance.read grant limits this screen to owners and admins", () => {
    expect(canReadWorkValue("owner")).toBe(true);
    expect(canReadWorkValue("admin")).toBe(true);
    for (const role of ["manager", "employee", "member", null]) expect(canReadWorkValue(role)).toBe(false);
  });
});
