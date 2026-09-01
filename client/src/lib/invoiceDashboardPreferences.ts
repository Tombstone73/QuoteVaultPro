export const INVOICE_TOTALS_VISIBILITY_STORAGE_KEY = "titanos.invoices.showTotals";

/** Browser-only presentation preference; invoice totals always remain server-authoritative. */
export function getInvoiceTotalsVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(INVOICE_TOTALS_VISIBILITY_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setInvoiceTotalsVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INVOICE_TOTALS_VISIBILITY_STORAGE_KEY, String(visible));
  } catch {
    // A blocked browser storage API must not prevent use of the dashboard.
  }
}
