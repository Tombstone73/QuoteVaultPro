export type QuickBooksSyncPolicy = "queue_only" | "immediate";

export type QuickBooksPreferences = {
  syncPolicy: QuickBooksSyncPolicy;
  /** Queue a newly approved native invoice for the existing bounded worker. */
  autoQueueApprovedInvoices: boolean;
};

export const DEFAULT_QUICKBOOKS_PREFERENCES: QuickBooksPreferences = {
  syncPolicy: "queue_only",
  // Preserve the established behavior for organizations that have not chosen
  // a setting yet: approval creates local queue work, never a provider call.
  autoQueueApprovedInvoices: true,
};

export function resolveQuickBooksPreferencesFromOrgPreferences(preferences: unknown): QuickBooksPreferences {
  const prefsObj = preferences && typeof preferences === "object" ? (preferences as any) : {};
  const qbObj = prefsObj.quickBooks && typeof prefsObj.quickBooks === "object" ? (prefsObj.quickBooks as any) : {};

  const rawPolicy = typeof qbObj.syncPolicy === "string" ? qbObj.syncPolicy : undefined;
  const syncPolicy: QuickBooksSyncPolicy = rawPolicy === "immediate" ? "immediate" : "queue_only";
  const autoQueueApprovedInvoices = qbObj.autoQueueApprovedInvoices !== false;

  return { syncPolicy, autoQueueApprovedInvoices };
}
