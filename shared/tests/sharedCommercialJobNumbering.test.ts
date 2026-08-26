import {
  formatSharedInvoiceNumber,
  formatSharedJobNumber,
  parseLegacyJobNumberBase,
  selectInitialSharedJobNumber,
} from "../documentNumbering";

describe("shared commercial Job Number formatting and legacy parsing", () => {
  test("uses the Job Number unchanged for a first invoice and suffixes later invoices from 2", () => {
    expect(formatSharedJobNumber(20342)).toBe("20342");
    expect(formatSharedInvoiceNumber(20342, 1)).toBe("20342");
    expect(formatSharedInvoiceNumber(20342, 2)).toBe("20342-2");
    expect(formatSharedInvoiceNumber(20342, 3)).toBe("20342-3");
  });

  test("extracts conservative numeric bases without treating an invoice suffix as a new Job Number", () => {
    expect(parseLegacyJobNumberBase("quote", "QT-22500")).toBe(22500);
    expect(parseLegacyJobNumberBase("quote", "qt18400")).toBe(18400);
    expect(parseLegacyJobNumberBase("order", "ORD-20209")).toBe(20209);
    expect(parseLegacyJobNumberBase("order", "ord_20209")).toBe(20209);
    expect(parseLegacyJobNumberBase("invoice", "INV-19100")).toBe(19100);
    expect(parseLegacyJobNumberBase("invoice", "inv19100")).toBe(19100);
    expect(parseLegacyJobNumberBase("invoice", "20342")).toBe(20342);
    expect(parseLegacyJobNumberBase("invoice", "20342-2")).toBe(20342);
    expect(parseLegacyJobNumberBase("quote", "legacy QT 22A")).toBeNull();
    expect(parseLegacyJobNumberBase("order", "ORDER-20A09")).toBeNull();
    expect(parseLegacyJobNumberBase("invoice", "INV--19100")).toBeNull();
    expect(parseLegacyJobNumberBase("quote", "0")).toBeNull();
    expect(parseLegacyJobNumberBase("order", "-20209")).toBeNull();
    expect(parseLegacyJobNumberBase("order", "2147483648")).toBeNull();
    expect(parseLegacyJobNumberBase("invoice", "999999999999999999999")).toBeNull();
  });

  test("selects the next shared number from the highest base across every document type", () => {
    expect(selectInitialSharedJobNumber({ quoteBases: [18400], orderBases: [20209], invoiceBases: [19100] }))
      .toMatchObject({ highestQuoteBase: 18400, highestOrderBase: 20209, highestInvoiceBase: 19100, nextJobNumber: 20210 });
    expect(selectInitialSharedJobNumber({ quoteBases: [22500], orderBases: [20209], invoiceBases: [19100] }).nextJobNumber).toBe(22501);
    expect(selectInitialSharedJobNumber({ quoteBases: [20209], orderBases: [19100], invoiceBases: [20342] }).nextJobNumber).toBe(20343);
    expect(selectInitialSharedJobNumber({ quoteBases: [], orderBases: [20342], invoiceBases: [20342] }).nextJobNumber).toBe(20343);
  });

  test("does not recycle an already advanced legacy counter when records have gaps", () => {
    expect(selectInitialSharedJobNumber({ quoteBases: [20342], orderBases: [], invoiceBases: [], existingNextCounters: [20350] }).nextJobNumber).toBe(20350);
    expect(() => selectInitialSharedJobNumber({ quoteBases: [2147483647], orderBases: [], invoiceBases: [] })).toThrow("exhausted");
  });
});
