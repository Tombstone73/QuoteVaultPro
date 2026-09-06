import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiUrl, resolveCanonicalApiRequestUrl } from "./apiConfig";
import { notifySessionExpired } from "./authUtils";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Intercept org-selection-required globally so every org-scoped page
    // automatically routes the user to the org picker.
    if (res.status === 409) {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.code === "ORG_SELECTION_REQUIRED") {
          window.location.href = "/select-org";
          return; // navigation is happening; don't throw
        }
      } catch { /* not JSON — fall through to normal error */ }
    }
    if (res.status === 401) {
      notifySessionExpired("api-request");
    }
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

  const res = await apiFetch(url, {
    method,
    ...init,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const fullUrl = resolveCanonicalApiRequestUrl(url);
  return fetch(fullUrl, {
    credentials: "include",
    ...init,
  });
}

export async function apiFetchBlob(url: string, init?: RequestInit): Promise<Blob> {
  const response = await apiFetch(url, init);
  await throwIfResNotOk(response);
  return response.blob();
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
    // Otherwise, resolve with apiUrl to handle environment-based backend routing
    const url = path.startsWith("http") ? path : apiUrl(path);
    
    const res = await apiFetch(url);

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
