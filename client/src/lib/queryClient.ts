import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getApiUrl } from "./apiConfig";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  
  if (data !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  // If url is a path (not absolute), resolve it with getApiUrl
  const fullUrl = url.startsWith("http") ? url : getApiUrl(url);

  const res = await fetch(fullUrl, {
    method,
    credentials: "include",
    ...init,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Build URL from query key
    const path = queryKey.join("/") as string;
    
    // If path is already absolute (starts with http), use as-is
    // Otherwise, resolve with getApiUrl to handle production Railway backend
    const url = path.startsWith("http") ? path : getApiUrl(path);
    
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
