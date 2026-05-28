import { describe, expect, test } from "@jest/globals";
import { isPickedUpArchivedForRetention, summarizeFulfillmentChecklist } from "../services/fulfillment/repository";

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
});
