import { useCallback, useEffect, useMemo, useState } from "react";

export type SalesUpdatedSort = "updated_desc" | "updated_asc";
export const defaultSalesUpdatedSort: SalesUpdatedSort = "updated_desc";

/** Browser-only lifecycle scope; server queries remain authoritative. */
export const salesOrderLifecycleFilters = [
  "All",
  "Open",
  "Completed",
  "Cancelled",
  "Archived",
] as const;
export type SalesOrderLifecycleFilter = (typeof salesOrderLifecycleFilters)[number];
export const defaultSalesOrderLifecycleFilter: SalesOrderLifecycleFilter = "All";

/** Mirrors the bounded server-side Orders workboard filter vocabulary. */
export const salesOrderOperationalFilters = [
  "all",
  "needs_artwork",
  "prepress",
  "production",
  "flatbed",
  "roll",
  "ready_for_fulfillment",
  "fulfillment",
  "open_balance",
] as const;
export type SalesOrderOperationalFilter = (typeof salesOrderOperationalFilters)[number];
export const defaultSalesOrderOperationalFilter: SalesOrderOperationalFilter = "all";

export const isSalesUpdatedSort = (value: unknown): value is SalesUpdatedSort =>
  value === "updated_desc" || value === "updated_asc";

export const isSalesOrderLifecycleFilter = (
  value: unknown,
): value is SalesOrderLifecycleFilter =>
  typeof value === "string" && (salesOrderLifecycleFilters as readonly string[]).includes(value);

export const isSalesOrderOperationalFilter = (
  value: unknown,
): value is SalesOrderOperationalFilter =>
  typeof value === "string" && (salesOrderOperationalFilters as readonly string[]).includes(value);

export const salesSortPreferenceKey = (
  documentKind: "quotes" | "orders",
  sessionScope: string,
  organizationId: string,
) => `ph.v2.sales.${documentKind}.updated-sort.${sessionScope}.${organizationId}`;

export const salesOrderLifecyclePreferenceKey = (
  sessionScope: string,
  organizationId: string,
) => `ph.v2.sales.orders.lifecycle-filter.${sessionScope}.${organizationId}`;

export const salesOrderOperationalPreferenceKey = (
  sessionScope: string,
  organizationId: string,
) => `ph.v2.sales.orders.operational-filter.${sessionScope}.${organizationId}`;

const localStorageOrUndefined = (): Storage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

export const readSalesUpdatedSort = (scopeKey?: string): SalesUpdatedSort => {
  if (!scopeKey) return defaultSalesUpdatedSort;
  try {
    const value = localStorageOrUndefined()?.getItem(scopeKey);
    return isSalesUpdatedSort(value) ? value : defaultSalesUpdatedSort;
  } catch {
    return defaultSalesUpdatedSort;
  }
};

export const writeSalesUpdatedSort = (
  scopeKey: string | undefined,
  value: SalesUpdatedSort,
): void => {
  if (!scopeKey || !isSalesUpdatedSort(value)) return;
  try {
    localStorageOrUndefined()?.setItem(scopeKey, value);
  } catch {
    // Preference storage is optional. It never controls Sales domain behavior.
  }
};

export const readSalesOrderLifecycleFilter = (
  scopeKey?: string,
): SalesOrderLifecycleFilter => {
  if (!scopeKey) return defaultSalesOrderLifecycleFilter;
  try {
    const value = localStorageOrUndefined()?.getItem(scopeKey);
    return isSalesOrderLifecycleFilter(value)
      ? value
      : defaultSalesOrderLifecycleFilter;
  } catch {
    return defaultSalesOrderLifecycleFilter;
  }
};

export const writeSalesOrderLifecycleFilter = (
  scopeKey: string | undefined,
  value: SalesOrderLifecycleFilter,
): void => {
  if (!scopeKey || !isSalesOrderLifecycleFilter(value)) return;
  try {
    localStorageOrUndefined()?.setItem(scopeKey, value);
  } catch {
    // Preference storage is optional. It never controls Sales domain behavior.
  }
};

export const readSalesOrderOperationalFilter = (
  scopeKey?: string,
): SalesOrderOperationalFilter => {
  if (!scopeKey) return defaultSalesOrderOperationalFilter;
  try {
    const value = localStorageOrUndefined()?.getItem(scopeKey);
    return isSalesOrderOperationalFilter(value)
      ? value
      : defaultSalesOrderOperationalFilter;
  } catch {
    return defaultSalesOrderOperationalFilter;
  }
};

export const writeSalesOrderOperationalFilter = (
  scopeKey: string | undefined,
  value: SalesOrderOperationalFilter,
): void => {
  if (!scopeKey || !isSalesOrderOperationalFilter(value)) return;
  try {
    localStorageOrUndefined()?.setItem(scopeKey, value);
  } catch {
    // Preference storage is optional. It never controls Sales domain behavior.
  }
};

/** A write is legal only after the exact authenticated scope has hydrated. */
export const mayWriteSalesUpdatedSort = (
  scopeKey: string | undefined,
  hydratedScopeKey: string | undefined,
): boolean => Boolean(scopeKey && scopeKey === hydratedScopeKey);

/**
 * Hydrates a browser-only convenience after the trusted UI session scope is
 * available.  It deliberately treats an unavailable scope differently from a
 * scope with no saved preference, so a boot-time default cannot overwrite a
 * saved value for the eventual authenticated organization.
 */
export const useSalesUpdatedSortPreference = (
  documentKind: "quotes" | "orders",
  sessionScope: string,
  organizationId: string,
) => {
  const scopeKey = useMemo(
    () =>
      sessionScope && organizationId
        ? salesSortPreferenceKey(documentKind, sessionScope, organizationId)
        : undefined,
    [documentKind, organizationId, sessionScope],
  );
  const [sort, setSortState] = useState<SalesUpdatedSort>(defaultSalesUpdatedSort);
  const [hydratedScopeKey, setHydratedScopeKey] = useState<string>();

  useEffect(() => {
    if (!scopeKey) {
      setSortState(defaultSalesUpdatedSort);
      setHydratedScopeKey(undefined);
      return;
    }
    setSortState(readSalesUpdatedSort(scopeKey));
    setHydratedScopeKey(scopeKey);
  }, [scopeKey]);

  const setSort = useCallback(
    (value: SalesUpdatedSort) => {
      if (!isSalesUpdatedSort(value)) return;
      setSortState(value);
      if (mayWriteSalesUpdatedSort(scopeKey, hydratedScopeKey))
        writeSalesUpdatedSort(scopeKey, value);
    },
    [hydratedScopeKey, scopeKey],
  );

  return {
    sort,
    setSort,
    preferenceReady: mayWriteSalesUpdatedSort(scopeKey, hydratedScopeKey),
  } as const;
};

/**
 * Hydrates a lifecycle filter only after the exact authenticated scope is
 * available, so the boot-time default cannot overwrite another tenant's
 * operator preference.
 */
export const useSalesOrderLifecycleFilterPreference = (
  sessionScope: string,
  organizationId: string,
) => {
  const scopeKey = useMemo(
    () =>
      sessionScope && organizationId
        ? salesOrderLifecyclePreferenceKey(sessionScope, organizationId)
        : undefined,
    [organizationId, sessionScope],
  );
  const [filter, setFilterState] = useState<SalesOrderLifecycleFilter>(
    defaultSalesOrderLifecycleFilter,
  );
  const [hydratedScopeKey, setHydratedScopeKey] = useState<string>();

  useEffect(() => {
    if (!scopeKey) {
      setFilterState(defaultSalesOrderLifecycleFilter);
      setHydratedScopeKey(undefined);
      return;
    }
    setFilterState(readSalesOrderLifecycleFilter(scopeKey));
    setHydratedScopeKey(scopeKey);
  }, [scopeKey]);

  const setFilter = useCallback(
    (value: SalesOrderLifecycleFilter) => {
      if (!isSalesOrderLifecycleFilter(value)) return;
      setFilterState(value);
      if (mayWriteSalesUpdatedSort(scopeKey, hydratedScopeKey))
        writeSalesOrderLifecycleFilter(scopeKey, value);
    },
    [hydratedScopeKey, scopeKey],
  );

  return {
    filter,
    setFilter,
    preferenceReady: mayWriteSalesUpdatedSort(scopeKey, hydratedScopeKey),
  } as const;
};

/** See useSalesOrderLifecycleFilterPreference for the scope-isolation rule. */
export const useSalesOrderOperationalFilterPreference = (
  sessionScope: string,
  organizationId: string,
) => {
  const scopeKey = useMemo(
    () =>
      sessionScope && organizationId
        ? salesOrderOperationalPreferenceKey(sessionScope, organizationId)
        : undefined,
    [organizationId, sessionScope],
  );
  const [filter, setFilterState] = useState<SalesOrderOperationalFilter>(
    defaultSalesOrderOperationalFilter,
  );
  const [hydratedScopeKey, setHydratedScopeKey] = useState<string>();

  useEffect(() => {
    if (!scopeKey) {
      setFilterState(defaultSalesOrderOperationalFilter);
      setHydratedScopeKey(undefined);
      return;
    }
    setFilterState(readSalesOrderOperationalFilter(scopeKey));
    setHydratedScopeKey(scopeKey);
  }, [scopeKey]);

  const setFilter = useCallback(
    (value: SalesOrderOperationalFilter) => {
      if (!isSalesOrderOperationalFilter(value)) return;
      setFilterState(value);
      if (mayWriteSalesUpdatedSort(scopeKey, hydratedScopeKey))
        writeSalesOrderOperationalFilter(scopeKey, value);
    },
    [hydratedScopeKey, scopeKey],
  );

  return {
    filter,
    setFilter,
    preferenceReady: mayWriteSalesUpdatedSort(scopeKey, hydratedScopeKey),
  } as const;
};
