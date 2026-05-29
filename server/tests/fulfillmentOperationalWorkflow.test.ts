import { describe, expect, test } from "@jest/globals";
import { isPickedUpArchivedForRetention, resolveFulfillmentUnreadyTransition, summarizeFulfillmentChecklist } from "../services/fulfillment/repository";
import { canRevertFulfillmentStatus, FULFILLMENT_REVERT_STATUS_PERMISSION } from "../services/fulfillment/service";
import { fulfillmentChecklistItemSchema } from "../services/fulfillment/schemas";

describe("fulfillment operational workflow helpers", () => {
  test("picked-up rows remain active before retention window", () => {
    const now = new Date("2026-05-28T12:00:00Z").getTime();
    expect(isPickedUpArchivedForRetention({
      status: "PICKED_UP",
      pickedUpAt: "2026-05-25T12:00:01Z",
    }, 3, now)).toBe(false);
  });

  test("picked-up rows archive after retention window", () => {
    const now = new Date("2026-05-28T12:00:00Z").getTime();
    expect(isPickedUpArchivedForRetention({
      status: "PICKED_UP",
      pickedUpAt: "2026-05-25T12:00:00Z",
    }, 3, now)).toBe(true);
  });

  test("non-picked-up rows do not archive through pickup retention", () => {
    const now = new Date("2026-05-28T12:00:00Z").getTime();
    expect(isPickedUpArchivedForRetention({
      status: "READY_FOR_PICKUP",
      pickedUpAt: "2026-05-20T12:00:00Z",
    }, 3, now)).toBe(false);
  });

  test("checklist summary requires every generated item to be checked", () => {
    expect(summarizeFulfillmentChecklist([
      { checked: true },
      { checked: false },
      { checked: true },
    ])).toEqual({
      total: 3,
      checked: 2,
      unchecked: 1,
      complete: false,
    });

    expect(summarizeFulfillmentChecklist([
      { checked: true },
      { checked: true },
    ])).toEqual({
      total: 2,
      checked: 2,
      unchecked: 0,
      complete: true,
    });
  });

  test("empty checklist is not treated as ready for terminal fulfillment", () => {
    expect(summarizeFulfillmentChecklist([])).toEqual({
      total: 0,
      checked: 0,
      unchecked: 0,
      complete: false,
    });
  });

  test("checklist mutation schema accepts checked and legacy verified payloads", () => {
    expect(fulfillmentChecklistItemSchema.parse({ checked: true })).toEqual({
      checked: true,
      notes: null,
    });
    expect(fulfillmentChecklistItemSchema.parse({ verified: false, notes: "missing package" })).toEqual({
      checked: false,
      notes: "missing package",
    });
    expect(() => fulfillmentChecklistItemSchema.parse({ notes: "missing checked flag" })).toThrow();
  });

  test("un-ready transition helper only allows controlled backward fulfillment moves", () => {
    expect(resolveFulfillmentUnreadyTransition("READY_FOR_PICKUP")).toEqual({
      ok: true,
      previousStatus: "READY_FOR_PICKUP",
      newStatus: "READY",
    });

    expect(resolveFulfillmentUnreadyTransition("ready")).toEqual({
      ok: true,
      previousStatus: "READY",
      newStatus: "DRAFT",
    });

    expect(resolveFulfillmentUnreadyTransition("picked_up")).toEqual({
      ok: false,
      code: "TERMINAL_STATUS_REVERT_BLOCKED",
    });

    expect(resolveFulfillmentUnreadyTransition("shipped")).toEqual({
      ok: false,
      code: "TERMINAL_STATUS_REVERT_BLOCKED",
    });

    expect(resolveFulfillmentUnreadyTransition("draft")).toEqual({
      ok: false,
      code: "INVALID_STATE",
    });
  });

  test("fulfillment revert permission fallback preserves owner admin manager access", () => {
    expect(FULFILLMENT_REVERT_STATUS_PERMISSION).toBe("fulfillment.revert_status");
    expect(canRevertFulfillmentStatus("owner")).toBe(true);
    expect(canRevertFulfillmentStatus("admin")).toBe(true);
    expect(canRevertFulfillmentStatus("manager")).toBe(true);
    expect(canRevertFulfillmentStatus("member")).toBe(false);
    expect(canRevertFulfillmentStatus(null)).toBe(false);
  });
});
