import { describe, expect, test } from "@jest/globals";
import {
  InvalidQuickBooksCustomerIdError,
  selectRetainedQuickBooksCustomerId,
} from "../quickBooksCustomerIdSelection";

describe("selectRetainedQuickBooksCustomerId", () => {
  test.each([
    [["299", "300"], "299", ["300"]],
    [["300", "299"], "299", ["300"]],
    [["99", "100"], "99", ["100"]],
    [["299", null], "299", []],
    [[null, "299"], "299", []],
    [["299", "299"], "299", []],
    [[null, null], null, []],
  ])("resolves %p to %s", (values, retainedQuickBooksCustomerId, retiredQuickBooksCustomerIds) => {
    expect(selectRetainedQuickBooksCustomerId(values)).toEqual({
      retainedQuickBooksCustomerId,
      retiredQuickBooksCustomerIds,
    });
  });

  test("rejects a malformed historical QuickBooks customer ID instead of guessing", () => {
    expect(() => selectRetainedQuickBooksCustomerId(["299", "QB-300"])).toThrow(InvalidQuickBooksCustomerIdError);
  });
});
