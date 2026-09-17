export type ArReportSort =
  | "customer"
  | "invoiceNumber"
  | "orderNumber"
  | "jobName"
  | "purchaseOrderNumber"
  | "issueDate"
  | "dueDate"
  | "daysPastDue"
  | "agingBucket"
  | "invoiceStatus"
  | "sendStatus"
  | "total"
  | "paid"
  | "balance";

export type ArReportColumn = {
  id: string;
  label: string;
  enabled: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  sortBy?: ArReportSort;
  numeric?: boolean;
};

export const arReportDefaultColumns: ArReportColumn[] = [
  { id: "customer", label: "Customer", enabled: true, width: 190, minWidth: 140, maxWidth: 480, sortBy: "customer" },
  { id: "contact", label: "Contact", enabled: true, width: 160, minWidth: 120, maxWidth: 360 },
  { id: "invoiceNumber", label: "Invoice #", enabled: true, width: 120, minWidth: 105, maxWidth: 220, sortBy: "invoiceNumber" },
  { id: "orderNumber", label: "Order #", enabled: true, width: 120, minWidth: 105, maxWidth: 220, sortBy: "orderNumber" },
  { id: "jobName", label: "Job / Order Name", enabled: true, width: 230, minWidth: 160, maxWidth: 560, sortBy: "jobName" },
  { id: "purchaseOrderNumber", label: "PO #", enabled: true, width: 145, minWidth: 105, maxWidth: 360, sortBy: "purchaseOrderNumber" },
  { id: "issueDate", label: "Issue", enabled: true, width: 112, minWidth: 100, maxWidth: 180, sortBy: "issueDate" },
  { id: "dueDate", label: "Due", enabled: true, width: 112, minWidth: 100, maxWidth: 180, sortBy: "dueDate" },
  { id: "daysPastDue", label: "Past Due", enabled: true, width: 92, minWidth: 78, maxWidth: 150, sortBy: "daysPastDue", numeric: true },
  { id: "agingBucket", label: "Aging", enabled: true, width: 112, minWidth: 95, maxWidth: 180, sortBy: "agingBucket" },
  { id: "invoiceStatus", label: "Invoice Status", enabled: true, width: 132, minWidth: 112, maxWidth: 240, sortBy: "invoiceStatus" },
  { id: "approval", label: "Approval", enabled: true, width: 100, minWidth: 88, maxWidth: 180 },
  { id: "sendStatus", label: "Send Status", enabled: true, width: 132, minWidth: 110, maxWidth: 230, sortBy: "sendStatus" },
  { id: "terms", label: "Terms", enabled: true, width: 112, minWidth: 90, maxWidth: 220 },
  { id: "total", label: "Total", enabled: true, width: 118, minWidth: 100, maxWidth: 220, sortBy: "total", numeric: true },
  { id: "paid", label: "Paid", enabled: true, width: 118, minWidth: 100, maxWidth: 220, sortBy: "paid", numeric: true },
  { id: "balance", label: "Balance", enabled: true, width: 126, minWidth: 105, maxWidth: 240, sortBy: "balance", numeric: true },
  { id: "lastSentAt", label: "Last Sent", enabled: true, width: 165, minWidth: 130, maxWidth: 280 },
  { id: "qbSyncStatus", label: "QB Sync", enabled: true, width: 120, minWidth: 100, maxWidth: 220 },
];

export type ArReportTablePreferences = {
  columns: ArReportColumn[];
  sortBy: ArReportSort;
  sortDir: "asc" | "desc";
};

export function getArReportPreferenceStorageKey(userId: string, organizationId: string) {
  return `titanos:accounts-receivable-report:columns:v1:${organizationId}:${userId}`;
}

export function normalizeArReportColumns(value: unknown): ArReportColumn[] {
  const saved = Array.isArray(value) ? value : [];
  const savedById = new Map(saved.filter((column): column is Partial<ArReportColumn> & { id: string } => Boolean(column && typeof column === "object" && typeof (column as any).id === "string")).map((column) => [column.id, column]));
  const orderedKnownIds = saved.map((column: any) => column?.id).filter((id: unknown): id is string => arReportDefaultColumns.some((column) => column.id === id));
  const allIds = [...new Set([...orderedKnownIds, ...arReportDefaultColumns.map((column) => column.id)])];
  return allIds.map((id) => {
    const defaults = arReportDefaultColumns.find((column) => column.id === id)!;
    const savedColumn = savedById.get(id);
    const width = Number(savedColumn?.width);
    return {
      ...defaults,
      enabled: typeof savedColumn?.enabled === "boolean" ? savedColumn.enabled : defaults.enabled,
      width: Number.isFinite(width) ? Math.min(defaults.maxWidth, Math.max(defaults.minWidth, width)) : defaults.width,
    };
  });
}

export function defaultArReportTablePreferences(): ArReportTablePreferences {
  return { columns: arReportDefaultColumns.map((column) => ({ ...column })), sortBy: "dueDate", sortDir: "asc" };
}
