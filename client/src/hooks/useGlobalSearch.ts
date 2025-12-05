import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";

export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}

export interface GlobalSearchResults {
  customers: SearchResult[];
  contacts: SearchResult[];
  orders: SearchResult[];
  quotes: SearchResult[];
  invoices: SearchResult[];
  jobs: SearchResult[];
}

const EMPTY_RESULTS: GlobalSearchResults = {
  customers: [],
  contacts: [],
  orders: [],
  quotes: [],
  invoices: [],
  jobs: [],
};

async function fetchGlobalSearch(query: string): Promise<GlobalSearchResults> {
  console.log("[GLOBAL SEARCH] fetchGlobalSearch called with query:", query);
  
  if (!query || query.length < 2) {
    console.log("[GLOBAL SEARCH] Query too short, returning empty results");
    return EMPTY_RESULTS;
  }

  const url = `/api/search?q=${encodeURIComponent(query)}`;
  console.log("[GLOBAL SEARCH] Fetching from:", url);
  
  const response = await fetch(url, {
    credentials: "include",
  });

  if (!response.ok) {
    console.error("[GLOBAL SEARCH] Response not OK:", response.status, response.statusText);
    throw new Error("Search failed");
  }

  const data = await response.json();
  console.log("[GLOBAL SEARCH] Response data:", data);
  console.log("[GLOBAL SEARCH] Customers count:", data?.customers?.length || 0);
  console.log("[GLOBAL SEARCH] First customer:", data?.customers?.[0]);
  
  return data;
}

export function useGlobalSearch(query: string, debounceMs = 300) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // Debounce the query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/search", debouncedQuery],
    queryFn: () => fetchGlobalSearch(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 1000 * 60, // 1 minute
  });

  // Calculate total results count
  const totalResults = data
    ? Object.values(data).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  // Get first result for Enter key navigation
  const firstResult = data
    ? Object.values(data)
        .flat()
        .find((result) => result !== undefined) as SearchResult | undefined
    : undefined;

  return {
    results: data || EMPTY_RESULTS,
    isLoading,
    error,
    totalResults,
    firstResult,
  };
}
