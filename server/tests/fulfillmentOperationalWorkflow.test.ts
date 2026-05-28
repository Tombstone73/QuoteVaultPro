import { describe, expect, test } from "@jest/globals";
import { isPickedUpArchivedForRetention } from "../services/fulfillment/repository";

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
});
