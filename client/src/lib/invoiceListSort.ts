export type InvoiceSortKey =
  | "invoiceNumber"
  | "customer"
  | "contact"
  | "jobName"
  | "orderNumber"
  | "purchaseOrderNumber"
  | "issueDate"
  | "dueDate"
  | "lastSentAt"
  | "status"
  | "approval"
  | "jobStatus"
  | "total"
  | "paid"
  | "balance";

export type InvoiceSortDir = "asc" | "desc";

export type InvoiceSortState = {
  sortKey: InvoiceSortKey;
  sortDir: InvoiceSortDir;
};

const DEFAULT_DESC_SORTS = new Set<InvoiceSortKey>(["issueDate", "dueDate", "lastSentAt", "total", "paid", "balance"]);

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

