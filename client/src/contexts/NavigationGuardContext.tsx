import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useLocation, useNavigate, type NavigateOptions } from "react-router-dom";
import {
  createNavigationGuardRegistry,
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
  registerGuard: (guard: NavigationGuardFn, shouldBlock: () => boolean) => () => void;
  guardedNavigate: (to: NavigationGuardTarget, options?: NavigateOptions) => void;
  isGuardActive: () => boolean;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export const NavigationGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const registryRef = useRef(createNavigationGuardRegistry());
  const navigate = useNavigate();
  const location = useLocation();

  const registerGuard = useCallback((guard: NavigationGuardFn, shouldBlock: () => boolean) => {
    const unregister = registryRef.current.registerGuard(guard, shouldBlock);
    const entries = registryRef.current.getEntries();
    const guardId = entries[entries.length - 1]?.id;

    if (import.meta.env.DEV) {
      console.log("[NavigationGuard] registered", {
        guardId,
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
          guardCount: remainingEntries.length,
          windowPath: window.location.pathname,
        });
      }
    };
  }, []);

  const isGuardActive = useCallback(() => {
    return registryRef.current.isGuardActive();
  }, []);

  const guardedNavigate = useCallback(
    (to: NavigationGuardTarget, options?: NavigateOptions) => {
      const origin = typeof window === "undefined" ? undefined : window.location.origin;
      const decision = registryRef.current.decideNavigation(to, (message) => window.confirm(message), origin);

      if (import.meta.env.DEV) {
        console.log("[NavigationGuard] guardedNavigate", {
          targetPath: decision.targetPath,
          reactRouterPath: location.pathname,
          windowPath: window.location.pathname,
          guardCount: registryRef.current.getEntries().length,
          activeGuardIds: decision.activeGuardIds,
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
      }
    },
    [location.pathname, navigate],
  );

  const contextValue = useMemo(
    () => ({
      registerGuard,
      guardedNavigate,
      isGuardActive,
    }),
    [registerGuard, guardedNavigate, isGuardActive],
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
