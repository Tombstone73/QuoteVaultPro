import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { User } from "@shared/schema";
import { getApiUrl } from "@/lib/apiConfig";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: [getApiUrl("/api/auth/user")],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/api/auth/user"), {
        credentials: "include",
      });
      
      // If 401, user is not authenticated - return null instead of throwing
      if (response.status === 401) {
        // Debug logging (non-production only)
        if (process.env.NODE_ENV !== "production") {
          console.log("[Auth] GET /api/auth/user returned 401 (not authenticated)");
        }
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch user: ${response.status}`);
      }
      
      const user = await response.json();
      
      // Debug logging (non-production only)
      if (process.env.NODE_ENV !== "production") {
        console.log("[Auth] User authenticated:", user?.email || user?.id);
      }
      
      return user;
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // User is authenticated if we have user data (not null and no error)
  const isAuthenticated = !!user && !error;

  return {
    user: user ?? undefined,
    isLoading,
    isAuthenticated,
    isAdmin: user?.isAdmin ?? false,
  };
}

// Optional wrapper for future-proofing: allows useUser() usage to keep working
export function useUser() {
  const { user } = useAuth();
  return user;
}

// Hook for logout functionality
export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logout = async () => {
    try {
      await fetch(getApiUrl("/api/auth/logout"), {
        method: "POST",
        credentials: "include",
      });

      // Clear all cached queries
      queryClient.clear();

      // Navigate to login
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Logout error:", error);
      // Even if logout fails, clear cache and navigate
      queryClient.clear();
      navigate("/login", { replace: true });
    }
  };

  return logout;
}
