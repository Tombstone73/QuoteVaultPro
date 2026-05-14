import { describe, expect, test } from "@jest/globals";
import {
  centsToCurrencyInput,
  currencyInputToCents,
  centsToCurrencyLabel,
} from "../pbv2/currency";

describe("currency helpers", () => {
  test("centsToCurrencyInput converts stored cents to dollar string", () => {
    expect(centsToCurrencyInput(575)).toBe("5.75");
    expect(centsToCurrencyInput(100)).toBe("1.00");
    expect(centsToCurrencyInput(0)).toBe("0.00");
    expect(centsToCurrencyInput(-250)).toBe("-2.50");
  });

  test("centsToCurrencyInput returns empty string for non-finite input", () => {
    expect(centsToCurrencyInput(null)).toBe("");
    expect(centsToCurrencyInput(undefined)).toBe("");
    expect(centsToCurrencyInput(NaN)).toBe("");
  });

  test("currencyInputToCents converts dollar string to cents", () => {
    expect(currencyInputToCents("5.75")).toBe(575);
    expect(currencyInputToCents("1.00")).toBe(100);
    expect(currencyInputToCents("0")).toBe(0);
    expect(currencyInputToCents("-2.50")).toBe(-250);
  });

  test("currencyInputToCents round-trips with centsToCurrencyInput", () => {
    const originalCents = 1234;
    const displayString = centsToCurrencyInput(originalCents);
    const backToCents = currencyInputToCents(displayString);
    expect(backToCents).toBe(originalCents);
  });

  test("existing data in cents hydrates correctly to dollar display", () => {
    // Data stored as cents (e.g., from DB): 500 cents = $5.00
    const storedCents = 500;
    const displayValue = centsToCurrencyInput(storedCents);
    expect(displayValue).toBe("5.00"); // user sees $5.00, not 500
  });

  test("user input of 5.75 stores as 575 cents internally", () => {
    const userInput = "5.75";
    const storedValue = currencyInputToCents(userInput);
    expect(storedValue).toBe(575); // stored as cents
  });

  test("centsToCurrencyLabel formats with sign and dollar symbol", () => {
    expect(centsToCurrencyLabel(575)).toBe("+$5.75");
    expect(centsToCurrencyLabel(-250)).toBe("-$2.50");
    expect(centsToCurrencyLabel(0)).toBe("+$0.00");
  });
});
