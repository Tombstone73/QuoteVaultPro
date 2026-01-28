import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // If we got a 401, user is not authenticated
  const isAuthenticated = !!user && !error;

  return {
    user,
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
      await fetch("/api/auth/logout", {
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
