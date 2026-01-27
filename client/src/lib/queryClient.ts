import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getApiUrl, parseJsonResponse } from "./apiConfig";

interface ApiRequestInit extends RequestInit {
  timeout?: number;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Try to parse as JSON first to get structured error
    let errorData: any;
    try {
      const text = await res.text();
      errorData = JSON.parse(text);
    } catch (e) {
      // Not JSON, use status text
      errorData = { message: res.statusText };
    }

    // Create error with structured data attached
    const error: any = new Error(errorData.message || `${res.status}: ${res.statusText}`);
    error.status = res.status;
    error.data = errorData;
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  init?: ApiRequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  
  if (data !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  // Create AbortController for timeout support
  const controller = new AbortController();
  const timeoutId = init?.signal ? undefined : setTimeout(() => {
    controller.abort();
  }, init?.timeout || 30000); // Default 30s timeout, can be overridden

  try {
    const res = await fetch(getApiUrl(url), {
      method,
      credentials: "include",
      ...init,
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: init?.signal || controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);
    await throwIfResNotOk(res);
    return res;
  } catch (error: any) {
    if (timeoutId) clearTimeout(timeoutId);
    
    // Better error messages for common cases
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(getApiUrl(queryKey.join("/") as string), {
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
