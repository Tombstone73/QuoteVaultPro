import { useCallback, useEffect, useMemo, useState } from "react";

export type SalesUpdatedSort = "updated_desc" | "updated_asc";
export const defaultSalesUpdatedSort: SalesUpdatedSort = "updated_desc";

export const isSalesUpdatedSort = (value: unknown): value is SalesUpdatedSort =>
  value === "updated_desc" || value === "updated_asc";

export const salesSortPreferenceKey = (
  documentKind: "quotes" | "orders",
  sessionScope: string,
  organizationId: string,
) => `ph.v2.sales.${documentKind}.updated-sort.${sessionScope}.${organizationId}`;

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
