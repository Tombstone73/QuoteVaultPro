import { afterEach, describe, expect, it } from "@jest/globals";
import {
  getInvoiceTotalsVisible,
  INVOICE_TOTALS_VISIBILITY_STORAGE_KEY,
  setInvoiceTotalsVisible,
} from "./invoiceDashboardPreferences";

describe("Invoice dashboard totals preference", () => {
  afterEach(() => window.localStorage.removeItem(INVOICE_TOTALS_VISIBILITY_STORAGE_KEY));

  it("shows totals by default", () => {
    expect(getInvoiceTotalsVisible()).toBe(true);
  });

  it("persists a hidden totals strip", () => {
    setInvoiceTotalsVisible(false);
    expect(window.localStorage.getItem(INVOICE_TOTALS_VISIBILITY_STORAGE_KEY)).toBe("false");
    expect(getInvoiceTotalsVisible()).toBe(false);
  });

  it("persists a visible totals strip", () => {
    setInvoiceTotalsVisible(true);
    expect(window.localStorage.getItem(INVOICE_TOTALS_VISIBILITY_STORAGE_KEY)).toBe("true");
    expect(getInvoiceTotalsVisible()).toBe(true);
  });
});
