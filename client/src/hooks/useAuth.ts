import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { getApiUrl } from "@/lib/apiConfig";
import { apiFetch } from "@/lib/queryClient";

type SessionResponse = {
  authenticated: boolean;
  user?: User;
  mustChangePassword?: boolean;
};

let authSessionSoftFailUntil = 0;

export function useAuth() {
  const { data: sessionData, isLoading, error } = useQuery<SessionResponse>({
    queryKey: [getApiUrl("/api/auth/session")],
    queryFn: async () => {
      const isLoginLikeRoute =
        typeof window !== "undefined" &&
        /^\/(login|forgot-password|reset-password|set-password|accept-invite)(\/|$)/i.test(window.location.pathname);

      if (isLoginLikeRoute && Date.now() < authSessionSoftFailUntil) {
        return { authenticated: false };
      }

      let response: Response;
      try {
        response = await apiFetch(getApiUrl("/api/auth/session"), {
          credentials: "include",
        });
      } catch {
        authSessionSoftFailUntil = Date.now() + 15_000;
        return { authenticated: false };
      }
      
      // Fail soft: treat auth/cookie/CORS permission failures as unauthenticated.
      if (response.status === 401 || response.status === 403) {
        authSessionSoftFailUntil = Date.now() + 15_000;
        if (process.env.NODE_ENV !== "production") {
          console.log(`[Auth] GET /api/auth/session returned ${response.status} (not authenticated)`);
        }
        return { authenticated: false };
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch session: ${response.status}`);
      }
      
      const sessionData = await response.json();
      
      // Debug logging (non-production only)
      if (process.env.NODE_ENV !== "production") {
        console.log("[Auth] Session:", {
          authenticated: sessionData.authenticated,
          email: sessionData.user?.email,
          mustChangePassword: sessionData.mustChangePassword,
        });
      }
      
      return sessionData;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: false,
    staleTime: 5 * 60 * 1000,
  });

  // User is authenticated if session says so and we have user data
  const isAuthenticated = sessionData?.authenticated === true && !!sessionData.user && !error;

  return {
    user: sessionData?.user,
    isLoading,
    isAuthenticated,
    isAdmin: sessionData?.user?.isAdmin ?? false,
    isPlatformAdmin: sessionData?.user?.isPlatformAdmin ?? false,
    mustChangePassword: sessionData?.mustChangePassword ?? false,
  };
}

// Optional wrapper for future-proofing: allows useUser() usage to keep working
export function useUser() {
  const { user } = useAuth();
  return user;
}

// Hook for logout functionality
export function useLogout() {
  const queryClient = useQueryClient();

  const logout = async () => {
    try {
      await apiFetch(getApiUrl("/api/auth/logout"), {
        method: "POST",
        credentials: "include",
      });

      // Clear all cached queries
      queryClient.clear();

      // Use window.location for full page navigation to avoid any routing issues
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout error:", error);
      // Even if logout fails, clear cache and navigate
      queryClient.clear();
      window.location.href = "/login";
    }
  };

  return logout;
}
