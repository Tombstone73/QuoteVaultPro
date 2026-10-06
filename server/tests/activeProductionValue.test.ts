import { projectActiveProductionValue, type ActiveProductionValueLine } from "../lib/activeProductionValue";

const org = "org-a";
const line = (overrides: Partial<ActiveProductionValueLine> = {}): ActiveProductionValueLine => ({
  id: "line-1",
  orderId: "order-1",
  organizationId: org,
  orderState: "open",
  orderStatus: "new",
  orderCanceledAt: null,
  statusPillId: "pill-new",
  statusPillKey: "new",
  statusPillValue: "New",
  workflowState: "new",
  lifecycleStatus: "new",
  lineItemRole: "standalone",
  parentLineItemId: null,
  parentPriceMode: "sum_children",
  valueCents: 12_440,
  ...overrides,
});

describe("Active Production Value from visible Order status pills", () => {
  test("one New line contributes to New and Total", () => {
    expect(projectActiveProductionValue(org, [line()])).toEqual({ newCents: 12_440, inProductionCents: 0, totalCents: 12_440 });
  });

  test("one In Production line contributes to In Production and Total", () => {
    expect(projectActiveProductionValue(org, [line({ statusPillId: "pill-production", statusPillKey: "in_production", statusPillValue: "In Production", workflowState: "in_production", valueCents: 30_375 })]))
      .toEqual({ newCents: 0, inProductionCents: 30_375, totalCents: 30_375 });
  });

  test("a Complete pill removes value even while legacy status and line workflow remain active", () => {
    expect(projectActiveProductionValue(org, [line({ statusPillId: "pill-complete", statusPillKey: "complete", statusPillValue: "Complete", orderStatus: "in_production", workflowState: "in_production", valueCents: 200_000 })]))
      .toEqual({ newCents: 0, inProductionCents: 0, totalCents: 0 });
  });

  test("a mixed Order counts only lines that have not completed production", () => {
    const pill = { statusPillId: "pill-production", statusPillKey: "in_production", statusPillValue: "In Production" };
    expect(projectActiveProductionValue(org, [
      line({ ...pill, workflowState: "completed", lifecycleStatus: "complete", valueCents: 50_000 }),
      line({ ...pill, workflowState: "in_production", valueCents: 30_000 }),
    ])).toEqual({ newCents: 0, inProductionCents: 30_000, totalCents: 30_000 });
  });

  test("multiple active lines contribute once each under their Order pill", () => {
    expect(projectActiveProductionValue(org, [
      line({ workflowState: "new", valueCents: 20_000 }),
      line({ workflowState: "in_production", valueCents: 40_000 }),
    ])).toEqual({ newCents: 60_000, inProductionCents: 0, totalCents: 60_000 });
  });

  test("a synthetic bundle parent is not counted alongside its child lines", () => {
    expect(projectActiveProductionValue(org, [
      line({ id: "parent", lineItemRole: "parent", valueCents: 40_000 }),
      line({ id: "child-a", parentLineItemId: "parent", lineItemRole: "child", valueCents: 20_000 }),
      line({ id: "child-b", parentLineItemId: "parent", lineItemRole: "child", valueCents: 20_000 }),
    ])).toEqual({ newCents: 40_000, inProductionCents: 0, totalCents: 40_000 });
  });

  test("an all-active bundle uses the canonical manual wrapper total once", () => {
    expect(projectActiveProductionValue(org, [
      line({ id: "parent", lineItemRole: "parent", parentPriceMode: "manual_override", valueCents: 50_000 }),
      line({ id: "child-a", parentLineItemId: "parent", lineItemRole: "child", valueCents: 20_000 }),
      line({ id: "child-b", parentLineItemId: "parent", lineItemRole: "child", valueCents: 20_000 }),
    ])).toEqual({ newCents: 50_000, inProductionCents: 0, totalCents: 50_000 });
  });

  test("a completed bundle child cannot retain its share of active production value", () => {
    expect(projectActiveProductionValue(org, [
      line({ id: "parent", lineItemRole: "parent", parentPriceMode: "manual_override", valueCents: 50_000 }),
      line({ id: "child-a", parentLineItemId: "parent", lineItemRole: "child", valueCents: 20_000, workflowState: "completed" }),
      line({ id: "child-b", parentLineItemId: "parent", lineItemRole: "child", valueCents: 20_000 }),
    ])).toEqual({ newCents: 20_000, inProductionCents: 0, totalCents: 20_000 });
  });

  test("canceled lines and Orders are excluded", () => {
    expect(projectActiveProductionValue(org, [
      line({ workflowState: "canceled", valueCents: 12_000 }),
      line({ lifecycleStatus: "canceled", valueCents: 13_000 }),
      line({ orderState: "canceled", valueCents: 14_000 }),
      line({ orderCanceledAt: new Date(), valueCents: 15_000 }),
    ])).toEqual({ newCents: 0, inProductionCents: 0, totalCents: 0 });
  });

  test("another tenant's line is excluded", () => {
    expect(projectActiveProductionValue(org, [line(), line({ organizationId: "org-b", valueCents: 99_999 })]))
      .toEqual({ newCents: 12_440, inProductionCents: 0, totalCents: 12_440 });
  });

  test("persisted total override cents are used without multiplying display unit price", () => {
    expect(projectActiveProductionValue(org, [line({ valueCents: 18_100 })]))
      .toEqual({ newCents: 18_100, inProductionCents: 0, totalCents: 18_100 });
  });

  test("legacy status alone never creates a visible-pill metric contribution", () => {
    expect(projectActiveProductionValue(org, [
      line({ statusPillId: null, statusPillKey: null, statusPillValue: null, orderStatus: "in_production", valueCents: 500 }),
      line({ statusPillId: "pill-other", statusPillKey: null, statusPillValue: "New", valueCents: 700 }),
    ])).toEqual({ newCents: 0, inProductionCents: 0, totalCents: 0 });
  });

  test("a persisted New pill label can identify legacy rows without a pill ID", () => {
    expect(projectActiveProductionValue(org, [
      line({ statusPillId: null, statusPillKey: null, statusPillValue: "New", orderStatus: "complete", valueCents: 900 }),
    ])).toEqual({ newCents: 900, inProductionCents: 0, totalCents: 900 });
  });
});
