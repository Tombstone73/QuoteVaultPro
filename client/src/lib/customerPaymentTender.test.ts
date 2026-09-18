import { parseTenderedAmountCents, resolveCustomerPaymentAmounts } from "./customerPaymentTender";

describe("customer payment tender calculations", () => {
  test("uses the entire tender for an exact selected balance", () => {
    expect(resolveCustomerPaymentAmounts(486700, parseTenderedAmountCents("4867.00")!)).toEqual({ appliedAmountCents: 486700, remainingBalanceCents: 0, changeDueCents: 0 });
  });

  test("keeps the unpaid remainder for a partial payment", () => {
    expect(resolveCustomerPaymentAmounts(486700, parseTenderedAmountCents("4000")!)).toEqual({ appliedAmountCents: 400000, remainingBalanceCents: 86700, changeDueCents: 0 });
  });

  test("caps an overpayment before it can be submitted as an invoice payment", () => {
    expect(resolveCustomerPaymentAmounts(486700, parseTenderedAmountCents("5000")!)).toEqual({ appliedAmountCents: 486700, remainingBalanceCents: 0, changeDueCents: 13300 });
  });

  test("preserves cents exactly and rejects malformed or non-positive input at the caller", () => {
    expect(resolveCustomerPaymentAmounts(9995, parseTenderedAmountCents("100.00")!)).toEqual({ appliedAmountCents: 9995, remainingBalanceCents: 0, changeDueCents: 5 });
    expect(parseTenderedAmountCents("1.999")).toBeNull();
    expect(parseTenderedAmountCents("-1")).toBeNull();
  });
});
