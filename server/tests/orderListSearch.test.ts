import { describe, expect, test } from "@jest/globals";
import { digitsOnlySearchTerm, normalizeOrderSearchTerm, orderSearchTokens, parseOrderSearchDate } from "../lib/orderListSearch";

describe("order list search normalization", () => {
  test.each([
    ["20032", "20032"],
    ["ORD-20032", "ord20032"],
    ["Order #20032", "order20032"],
  ])("normalizes operational order search %s", (input, expected) => {
    expect(normalizeOrderSearchTerm(input)).toBe(expected);
  });

  test("keeps multi-token operational terms deterministic", () => {
    expect(orderSearchTokens(" graphic   football ")).toEqual(["graphic", "football"]);
  });

  test("normalizes phone punctuation without treating short numbers as phone searches", () => {
    expect(digitsOnlySearchTerm("(317) 727-8820")).toBe("3177278820");
    expect(digitsOnlySearchTerm("20032")).toBe("20032");
  });

  test.each([
    ["08/12/2026", "2026-08-12T00:00:00.000Z"],
    ["Aug 12, 2026", "2026-08-12T00:00:00.000Z"],
  ])("parses supported due-date search input %s without locale parsing", (input, expectedStart) => {
    expect(parseOrderSearchDate(input)).toEqual({ start: expectedStart, end: "2026-08-13T00:00:00.000Z" });
    expect(orderSearchTokens(input)).toEqual([]);
  });

  test("rejects ambiguous and invalid date input", () => {
    expect(parseOrderSearchDate("12/08/2026")).toEqual({ start: "2026-12-08T00:00:00.000Z", end: "2026-12-09T00:00:00.000Z" });
    expect(parseOrderSearchDate("2026-08-12")).toBeNull();
    expect(parseOrderSearchDate("02/30/2026")).toBeNull();
  });
});
