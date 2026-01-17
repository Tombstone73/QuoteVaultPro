export type QuickBooksSyncPolicy = "queue_only" | "immediate";

export type QuickBooksPreferences = {
  syncPolicy: QuickBooksSyncPolicy;
};

export const DEFAULT_QUICKBOOKS_PREFERENCES: QuickBooksPreferences = {
  syncPolicy: "queue_only",
};

export function resolveQuickBooksPreferencesFromOrgPreferences(preferences: unknown): QuickBooksPreferences {
  const prefsObj = preferences && typeof preferences === "object" ? (preferences as any) : {};
  const qbObj = prefsObj.quickBooks && typeof prefsObj.quickBooks === "object" ? (prefsObj.quickBooks as any) : {};

  const rawPolicy = typeof qbObj.syncPolicy === "string" ? qbObj.syncPolicy : undefined;
  const syncPolicy: QuickBooksSyncPolicy = rawPolicy === "immediate" ? "immediate" : "queue_only";

  return { syncPolicy };
}
