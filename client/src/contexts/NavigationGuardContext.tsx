import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useLocation, useNavigate, type NavigateOptions } from "react-router-dom";
import { notifyBrowserRouterOfCurrentUrlSoon } from "@/lib/nav/browserRouterSync";
import {
  createNavigationGuardRegistry,
  type NavigationGuardDiagnostics,
  type NavigationGuardFn,
  type NavigationGuardTarget,
} from "./navigationGuardCore";

/**
 * NavigationGuardContext
 *
 * BrowserRouter-safe navigation guard for explicit in-app navigations.
 *
 * Important: BrowserRouter cannot synchronously block browser back/forward
 * before the URL changes. The previous POP-reversal approach could leave the
 * address bar and React Router render tree out of sync. This provider therefore
 * only guards navigation that calls `guardedNavigate`; refresh/close protection
 * stays with page-level `beforeunload` handlers.
 *
 * TODO: If the app migrates to Data Router (RouterProvider + createBrowserRouter),
 * replace this explicit guard with React Router's official blocker APIs.
 */

interface NavigationGuardContextValue {
  registerGuard: (guard: NavigationGuardFn, shouldBlock: () => boolean, label?: string) => () => void;
  guardedNavigate: (to: NavigationGuardTarget, options?: NavigateOptions) => void;
  isGuardActive: () => boolean;
  getGuardDiagnostics: () => NavigationGuardDiagnostics;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export const NavigationGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const registryRef = useRef(createNavigationGuardRegistry());
  const navigate = useNavigate();
  const location = useLocation();

  const registerGuard = useCallback((guard: NavigationGuardFn, shouldBlock: () => boolean, label?: string) => {
    const unregister = registryRef.current.registerGuard(guard, shouldBlock, label);
    const entries = registryRef.current.getEntries();
    const guardId = entries[entries.length - 1]?.id;

    if (import.meta.env.DEV) {
      console.log("[NavigationGuard] registered", {
        guardId,
        label: label ?? "anonymous",
        guardCount: entries.length,
        windowPath: window.location.pathname,
      });
    }

    return () => {
      unregister();
      const remainingEntries = registryRef.current.getEntries();

      if (import.meta.env.DEV) {
        console.log("[NavigationGuard] unregistered", {
          guardId,
          label: label ?? "anonymous",
          guardCount: remainingEntries.length,
          windowPath: window.location.pathname,
        });
      }
    };
  }, []);

  const isGuardActive = useCallback(() => {
    return registryRef.current.isGuardActive();
  }, []);

  const getGuardDiagnostics = useCallback(() => {
    return registryRef.current.getDiagnostics();
  }, []);

  const guardedNavigate = useCallback(
    (to: NavigationGuardTarget, options?: NavigateOptions) => {
      const origin = typeof window === "undefined" ? undefined : window.location.origin;
      const decision = registryRef.current.decideNavigation(to, (message) => window.confirm(message), origin);

      if (import.meta.env.DEV) {
        const diagnostics = registryRef.current.getDiagnostics();
        console.log("[NavigationGuard] guardedNavigate", {
          targetPath: decision.targetPath,
          reactRouterPath: location.pathname,
          windowPath: window.location.pathname,
          guardCount: diagnostics.registeredGuardCount,
          activeGuardIds: decision.activeGuardIds,
          activeGuardLabels: diagnostics.activeGuardLabels,
          guards: diagnostics.guards,
          allowed: decision.allowed,
        });
      }

      if (!decision.allowed) {
        if (import.meta.env.DEV) {
          console.log("[NavigationGuard] navigation denied before URL change", {
            guardId: decision.blockedGuardId,
            targetPath: decision.targetPath,
            windowPath: window.location.pathname,
            reactRouterPath: location.pathname,
          });
        }
        return;
      }

      if (import.meta.env.DEV) {
        console.log("[NavigationGuard] navigation allowed", {
          targetPath: decision.targetPath,
          windowPath: window.location.pathname,
          reactRouterPath: location.pathname,
        });
      }

      if (typeof to === "number") {
        navigate(to);
      } else {
        navigate(to, options);
        notifyBrowserRouterOfCurrentUrlSoon();
      }
    },
    [location.pathname, navigate],
  );

  const contextValue = useMemo(
    () => ({
      registerGuard,
      guardedNavigate,
      isGuardActive,
      getGuardDiagnostics,
    }),
    [registerGuard, guardedNavigate, isGuardActive, getGuardDiagnostics],
  );

  return (
    <NavigationGuardContext.Provider value={contextValue}>
      {children}
    </NavigationGuardContext.Provider>
  );
};

export const useNavigationGuard = () => {
  const context = useContext(NavigationGuardContext);
  if (!context) {
    throw new Error("useNavigationGuard must be used within NavigationGuardProvider");
  }
  return context;
};
