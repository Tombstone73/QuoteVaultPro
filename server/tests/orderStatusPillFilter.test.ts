import { parseOrderStatusPillIdsQuery } from "../routes/helpers/orderStatusPillFilter";

describe("parseOrderStatusPillIdsQuery", () => {
  it("keeps an omitted filter distinct from an explicit empty filter", () => {
    expect(parseOrderStatusPillIdsQuery(undefined)).toBeUndefined();
    expect(parseOrderStatusPillIdsQuery("")).toEqual([]);
  });

  it("accepts comma-separated or repeated IDs and removes duplicates", () => {
    expect(parseOrderStatusPillIdsQuery(["ready,complete", "complete,waiting"])).toEqual([
      "ready",
      "complete",
      "waiting",
    ]);
  });

  it("ignores non-string query values", () => {
    expect(parseOrderStatusPillIdsQuery(["ready", 42, null])).toEqual(["ready"]);
  });
});
