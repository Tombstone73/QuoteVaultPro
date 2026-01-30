import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { getApiUrl } from "@/lib/apiConfig";

type SessionResponse = {
  authenticated: boolean;
  user?: User;
  mustChangePassword?: boolean;
};

export function useAuth() {
  const { data: sessionData, isLoading, error } = useQuery<SessionResponse>({
    queryKey: [getApiUrl("/api/auth/session")],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/auth/session"), {
        credentials: "include",
      });
      
      // If 401, user is not authenticated
      if (response.status === 401) {
        if (process.env.NODE_ENV !== "production") {
          console.log("[Auth] GET /api/auth/session returned 401 (not authenticated)");
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
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // User is authenticated if session says so and we have user data
  const isAuthenticated = sessionData?.authenticated === true && !!sessionData.user && !error;

  return {
    user: sessionData?.user,
    isLoading,
    isAuthenticated,
    isAdmin: sessionData?.user?.isAdmin ?? false,
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
      await fetch(getApiUrl("/api/auth/logout"), {
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
