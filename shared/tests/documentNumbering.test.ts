import { describe, expect, test } from "@jest/globals";

import {
  documentNumberMatchesSearch,
  formatDocumentNumber,
  formatProductionDocumentNumber,
  resolveDocumentDisplayNumber,
  sanitizeDocumentNumberPrefix,
} from "../documentNumbering";

describe("document numbering helpers", () => {
  test("formats quote, order, and invoice numbers with configurable prefixes", () => {
    expect(formatDocumentNumber("QT-", 1006)).toBe("QT-1006");
    expect(formatDocumentNumber("ORD-", 1006)).toBe("ORD-1006");
    expect(formatDocumentNumber("INV-", 1006)).toBe("INV-1006");
  });

  test("allows blank prefixes and safe prefix characters", () => {
    expect(sanitizeDocumentNumberPrefix("")).toBe("");
    expect(sanitizeDocumentNumberPrefix("  ORD_")).toBe("ORD_");
    expect(sanitizeDocumentNumberPrefix("INV-")).toBe("INV-");
  });

  test("rejects unsafe or overly long prefixes", () => {
    expect(() => sanitizeDocumentNumberPrefix("INV/{year}-")).toThrow();
    expect(() => sanitizeDocumentNumberPrefix("A".repeat(17))).toThrow();
  });

  test("search by numeric core matches prefixed document numbers", () => {
    for (const displayNumber of ["QT-1006", "ORD-1006", "INV-1006"]) {
      expect(documentNumberMatchesSearch({ query: "1006", displayNumber, numberCore: 1006 })).toBe(true);
    }
  });

  test("search by full display number matches while ignoring punctuation and case", () => {
    expect(documentNumberMatchesSearch({ query: "ord1006", displayNumber: "ORD-1006", numberCore: 1006 })).toBe(true);
    expect(documentNumberMatchesSearch({ query: "INV-1006", displayNumber: "INV_1006", numberCore: 1006 })).toBe(true);
  });

  test("resolves frozen display numbers before legacy fallbacks", () => {
    expect(resolveDocumentDisplayNumber({ displayNumber: "ORD-1006", numberCore: 1006, legacyNumber: "1006" })).toBe("ORD-1006");
    expect(resolveDocumentDisplayNumber({ numberCore: 1006, legacyNumber: "1006", prefix: "ORD-" })).toBe("ORD-1006");
  });

  test("production display toggle can show number only without mutating the stored display number", () => {
    const args = { displayNumber: "ORD-1006", numberCore: 1006, legacyNumber: "1006" };
    expect(formatProductionDocumentNumber({ ...args, mode: "full" })).toBe("ORD-1006");
    expect(formatProductionDocumentNumber({ ...args, mode: "number_only" })).toBe("1006");
  });
});
