import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";

export type CustomerSearchResult = {
  id: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  contacts?: unknown[];
};

export type CustomerSearchPage = {
  customers: CustomerSearchResult[];
  pagination: { page?: number; pageSize?: number; total?: number; totalPages?: number; hasNextPage?: boolean };
};

/** Debounce server searches so a response for an older term can never replace
 * the query keyed by the current term. */
export function useDebouncedValue(value: string, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export function useCustomerSearchPage({
  search,
  page = 1,
  pageSize = 25,
  enabled = true,
}: {
  search?: string;
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}) {
  const normalizedSearch = search?.trim() || "";
  return useQuery<CustomerSearchPage>({
    queryKey: ["customers", "search", normalizedSearch, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (normalizedSearch) params.set("search", normalizedSearch);
      const response = await apiFetch(`/api/customers?${params}`);
      if (!response.ok) throw new Error("Failed to fetch customers");
      const payload = await response.json();
      return {
        customers: Array.isArray(payload?.data?.customers) ? payload.data.customers : [],
        pagination: payload?.data?.pagination || {},
      };
    },
    enabled,
    staleTime: 30_000,
  });
}

/** Resolve saved selections that are outside the currently loaded search page. */
export function useCustomerById<T extends CustomerSearchResult = CustomerSearchResult>(id?: string | null, enabled = true) {
  return useQuery<T>({
    queryKey: ["customers", "by-id", id],
    queryFn: async () => {
      if (!id) throw new Error("No customer ID");
      const response = await apiFetch(`/api/customers/${id}`);
      if (!response.ok) throw new Error("Failed to fetch customer");
      const payload = await response.json();
      return (payload?.data?.customer ?? payload?.data ?? payload) as T;
    },
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
  });
}

export function mergeCustomerSearchRows<T extends { id: string }>(existing: T[], incoming: T[]) {
  return Array.from(new Map([...existing, ...incoming].map((customer) => [customer.id, customer])).values());
}
