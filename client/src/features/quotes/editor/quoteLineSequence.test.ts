import { applyQuoteLineSequence } from "./quoteLineSequence";
import { moveQuoteLineGroup } from "@shared/quoteLineOrder";
import { reconcileLineItemListSafely } from "@/components/orders/orderLineItemEditState";

test("editor canonical state and refetch/reload keep reordered group fields intact", () => {
  const rows = [
    { id: "a", displayOrder: 0, linePrice: 220.44, quantity: 2, width: 54.21, productId: "acm" },
    { id: "a1", parentLineItemId: "a", displayOrder: 1, linePrice: 108 },
    { id: "b", displayOrder: 2, linePrice: 30 },
  ];
  const moved = moveQuoteLineGroup(rows, "b", "a");
  const saved = applyQuoteLineSequence(rows, moved.map((row) => row.id));
  const refetched = reconcileLineItemListSafely(rows, JSON.parse(JSON.stringify(saved)), { patchKind: "hydration" });
  expect(refetched.map((row) => row.id)).toEqual(["b", "a", "a1"]);
  expect(refetched.map((row) => row.displayOrder)).toEqual([0, 1, 2]);
  expect(reconcileLineItemListSafely([], saved, { patchKind: "hydration" })).toEqual(saved);
  expect(saved.find((row) => row.id === "a")).toEqual({ ...rows[0], displayOrder: 1 });
  expect(rows[0].displayOrder).toBe(0);
});

test("new Quote TEMP keys update canonical state and preserve newly added lines", () => {
  const drafts = [{ tempId: "a", displayOrder: 0 }, { tempId: "b", displayOrder: 1 }];
  expect(applyQuoteLineSequence(drafts, ["b", "a"]).map((row) => row.tempId)).toEqual(["b", "a"]);
  expect(applyQuoteLineSequence([...drafts, { tempId: "c", displayOrder: 2 }], ["b", "a"], true).map((row) => row.tempId)).toEqual(["b", "a", "c"]);
  expect(() => applyQuoteLineSequence(drafts, ["b"])).toThrow("changed");
});
