import { resolveSystemGuideAnswer } from "../services/assistant/systemGuide";

const context = { contextVersion: "v1" as const, route: "/orders/order_1", pageTitle: "Order", entityType: "order" as const, entityId: "order_1", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-23T00:00:00.000Z", unsavedChanges: false };

describe("System Guide routing", () => {
  it("answers a general order workflow without requiring a record", () => {
    const result = resolveSystemGuideAnswer("How does a new order get from order entry to printing?", { ...context, route: "/orders", entityType: undefined, entityId: undefined });
    expect(result?.title).toBe("Order workflow");
    expect(result?.response).toMatch(/routing/i);
  });

  it("uses approved route context for current-screen help", () => {
    const result = resolveSystemGuideAnswer("What does this page do?", context);
    expect(result?.response).toMatch(/Order detail/i);
    expect(result?.cards[0]).toMatchObject({ kind: "partial_result" });
  });

  it("does not turn an action request into help", () => {
    expect(resolveSystemGuideAnswer("Move this order to fulfillment", context)).toBeNull();
  });

  it("recognizes Flatbed wording as System Guide help only until a persisted product continuation defers it", () => {
    expect(resolveSystemGuideAnswer("Use 48×96 sheets, Flatbed routing, allow rotation, and set a $25 minimum.", context)?.title)
      .toBe("Production routing");
  });

  it("uses the live order summary path for billing diagnosis", () => {
    expect(resolveSystemGuideAnswer("Why can't this order be invoiced?", context)).toBeNull();
  });
});
