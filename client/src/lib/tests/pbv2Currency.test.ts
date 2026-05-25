import { describe, expect, test } from "@jest/globals";
import {
  centsToCurrencyInput,
  centsToCurrencyRateInput,
  currencyInputToCents,
  currencyRateInputToCents,
  centsToCurrencyLabel,
  normalizeVariableDisplay,
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

  test("rate helpers preserve fractional cents for high-precision pricing", () => {
    expect(currencyRateInputToCents("1.375")).toBe(137.5);
    expect(centsToCurrencyRateInput(137.5)).toBe("1.375");
    expect(centsToCurrencyRateInput(132)).toBe("1.32");
  });

  test("centsToCurrencyLabel formats with sign and dollar symbol", () => {
    expect(centsToCurrencyLabel(575)).toBe("+$5.75");
    expect(centsToCurrencyLabel(-250)).toBe("-$2.50");
    expect(centsToCurrencyLabel(0)).toBe("+$0.00");
  });
});

describe("normalizeVariableDisplay (blur normalization)", () => {
  test('"5" normalizes to "5.00"', () => {
    expect(normalizeVariableDisplay("5")).toBe("5.00");
  });

  test('"5.7" normalizes to "5.70"', () => {
    expect(normalizeVariableDisplay("5.7")).toBe("5.70");
  });

  test('"5.75" stays "5.75"', () => {
    expect(normalizeVariableDisplay("5.75")).toBe("5.75");
  });

  test('"1.375" stays high precision', () => {
    expect(normalizeVariableDisplay("1.375")).toBe("1.375");
  });

  test('"5." normalizes to "5.00" on blur', () => {
    // During typing "5." is preserved as raw local state; on blur it normalizes
    expect(normalizeVariableDisplay("5.")).toBe("5.00");
  });

  test("empty string passes through unchanged", () => {
    expect(normalizeVariableDisplay("")).toBe("");
  });

  test("non-numeric partial (e.g. sign-only) passes through unchanged", () => {
    // "-" alone is not a finite number — preserved during typing
    expect(normalizeVariableDisplay("-")).toBe("-");
  });

  test("negative values normalize correctly", () => {
    expect(normalizeVariableDisplay("-2.5")).toBe("-2.50");
    expect(normalizeVariableDisplay("-2.50")).toBe("-2.50");
  });

  test("already normalized values are stable", () => {
    const v = normalizeVariableDisplay("12.34");
    expect(normalizeVariableDisplay(v)).toBe("12.34");
  });
});
