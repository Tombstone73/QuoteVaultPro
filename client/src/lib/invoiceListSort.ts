export type InvoiceSortKey =
  | "invoiceNumber"
  | "customer"
  | "contact"
  | "orderNumber"
  | "purchaseOrderNumber"
  | "issueDate"
  | "dueDate"
  | "status"
  | "total"
  | "balance";

export type InvoiceSortDir = "asc" | "desc";

export type InvoiceSortState = {
  sortKey: InvoiceSortKey;
  sortDir: InvoiceSortDir;
};

const DEFAULT_DESC_SORTS = new Set<InvoiceSortKey>(["issueDate", "dueDate", "total", "balance"]);

export function getDefaultInvoiceSortDir(key: InvoiceSortKey): InvoiceSortDir {
  return DEFAULT_DESC_SORTS.has(key) ? "desc" : "asc";
}

export function getNextInvoiceSortState(current: InvoiceSortState, key: InvoiceSortKey): InvoiceSortState {
  if (current.sortKey === key) {
    return {
      sortKey: key,
      sortDir: current.sortDir === "asc" ? "desc" : "asc",
    };
  }

  return {
    sortKey: key,
    sortDir: getDefaultInvoiceSortDir(key),
  };
}

