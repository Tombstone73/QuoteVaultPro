import { stripeBatchExpectedBalances } from "../stripeBatchExpectedBalances";

describe("Stripe batch balance snapshot", () => {
  const allocations = [{ invoiceId: "a", amountCents: 50000 }, { invoiceId: "b", amountCents: 10000 }];

  test("keeps the full reviewed balances for a partial allocation", () => {
    expect(stripeBatchExpectedBalances({ expectedRemainingCents: { a: 50000, b: 38810 } }, allocations))
      .toEqual({ a: 50000, b: 38810 });
  });

  test("supports legacy full-balance portal batches", () => {
    expect(stripeBatchExpectedBalances({ portal: true }, allocations)).toEqual({ a: 50000, b: 10000 });
  });

  test.each([
    {},
    { expectedRemainingCents: { a: 50000 } },
    { expectedRemainingCents: { a: 50000, b: 9999 } },
    { expectedRemainingCents: { a: 50000, b: 38810, c: 1 } },
    { expectedRemainingCents: { a: 50000, b: "38810" } },
    { expectedRemainingCents: { a: 50000, b: 38810.5 } },
  ])("rejects missing or invalid snapshots: %p", (evidence) => {
    expect(() => stripeBatchExpectedBalances(evidence, allocations)).toThrow();
  });
});
