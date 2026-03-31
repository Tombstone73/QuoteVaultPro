import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import { mockSession } from "@/lib/mock-data";
import { isMockMode as checkMockMode } from "@/lib/runtime-config";
import type { PortalSession } from "@/types/portal";

interface AuthContextValue {
  user: PortalSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  checkSession: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PortalSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkSession = useCallback(async () => {
    if (checkMockMode()) {
      setUser(mockSession);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const session = await api.get<PortalSession>("/auth/user");
      setUser(session);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        console.error("Session check failed:", err);
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const logout = useCallback(() => {
    setUser(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, checkSession, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
