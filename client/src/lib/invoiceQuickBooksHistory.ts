/** Current approval/sync state must not erase evidence of an earlier export. */
export function hasPreviousQuickBooksSync(invoice: {
  lastQbSyncedVersion?: number | null;
  syncedAt?: unknown;
  syncStatus?: string | null;
  qbSyncStatus?: string | null;
} | null | undefined): boolean {
  return Boolean(invoice && (invoice.lastQbSyncedVersion || invoice.syncedAt
    || invoice.syncStatus === "synced" || invoice.qbSyncStatus === "synced"));
}

export function quickBooksHistoryLabel(currentLabel: string, previouslySynced: boolean, upToDate: boolean): string {
  return previouslySynced && !upToDate && currentLabel !== "Imported"
    ? `Previously synced · ${currentLabel === "Not Synced" ? "Update required" : currentLabel}`
    : currentLabel;
}
