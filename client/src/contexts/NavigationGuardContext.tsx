import React, { createContext, useContext, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';

/**
 * NavigationGuardContext
 * 
 * Enterprise-safe navigation guard system for BrowserRouter apps.
 * Provides guard state and functions for conditional navigation interception.
 * 
 * Critical: Only intercepts when guard is active (dirty=true).
 * 
 * TODO: When migrating to Data Router (RouterProvider + createBrowserRouter),
 * replace this with official useBlocker hook and errorElement boundaries.
 * See: https://reactrouter.com/en/main/hooks/use-blocker
 */

type NavigationGuardFn = (targetPath: string) => string | boolean;

interface NavigationGuardContextValue {
  registerGuard: (guard: NavigationGuardFn, shouldBlock: () => boolean) => () => void;
  guardedNavigate: (to: string) => void;
  isGuardActive: () => boolean; // Check if guard would block
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export const NavigationGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const guardRef = useRef<NavigationGuardFn | null>(null);
  const shouldBlockRef = useRef<(() => boolean) | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastStableLocationRef = useRef<string>(location.pathname + location.search);
  const isRevertingRef = useRef<boolean>(false);

  const registerGuard = useCallback((guard: NavigationGuardFn, shouldBlock: () => boolean) => {
    guardRef.current = guard;
    shouldBlockRef.current = shouldBlock;
    return () => {
      guardRef.current = null;
      shouldBlockRef.current = null;
    };
  }, []);

  // Check if guard would currently block navigation
  const isGuardActive = useCallback(() => {
    const shouldBlock = shouldBlockRef.current;
    if (!shouldBlock) return false;
    return shouldBlock();
  }, []);

  // Guarded navigate for PUSH navigation (sidebar clicks, programmatic nav)
  const guardedNavigate = useCallback((to: string) => {
    const shouldBlock = shouldBlockRef.current;
    const guard = guardRef.current;
    
    // CRITICAL: Check shouldBlock() FIRST before calling guard
    // If no shouldBlock function OR it returns false, navigate immediately
    if (!shouldBlock || !shouldBlock()) {
      navigate(to);
      return;
    }
    
    // shouldBlock returned true - dirty state, check guard
    if (!guard) {
      // No guard function but shouldBlock is true - allow navigation anyway
      navigate(to);
      return;
    }

    const result = guard(to);
    
    // Guard returned false/null/undefined, allow navigation
    if (!result) {
      navigate(to);
      return;
    }

    // Guard returned true, block silently
    if (result === true) {
      return;
    }

    // Guard returned string message, show confirm
    const confirmed = window.confirm(result);
    if (confirmed) {
      navigate(to);
    }
  }, [navigate]);

  // Handle browser back/forward (POP navigation)
  // Only intercepts when guard is active (dirty=true)
  useEffect(() => {
    const currentPath = location.pathname + location.search;
    
    // CRITICAL: Only run guard logic for POP navigation (browser back/forward)
    // NavLink clicks are PUSH navigation and should NEVER be intercepted here
    if (navigationType !== 'POP') {
      lastStableLocationRef.current = currentPath;
      if (import.meta.env.DEV) {
        console.log('[GUARD] Allowing PUSH/REPLACE navigation, type:', navigationType, 'to:', currentPath);
      }
      return;
    }
    
    if (import.meta.env.DEV) {
      console.log('[GUARD] POP navigation detected from:', lastStableLocationRef.current, 'to:', currentPath);
    }
    
    // Skip guard logic if we're currently reverting a POP to avoid recursion
    if (isRevertingRef.current) {
      isRevertingRef.current = false;
      lastStableLocationRef.current = currentPath;
      if (import.meta.env.DEV) {
        console.log('[GUARD] Skipping guard logic (currently reverting)');
      }
      return;
    }

    const shouldBlock = shouldBlockRef.current;
    const guard = guardRef.current;
    
    // CRITICAL: Check shouldBlock() FIRST before running guard logic
    // If no shouldBlock function OR it returns false, allow POP navigation immediately
    if (!shouldBlock || !shouldBlock()) {
      lastStableLocationRef.current = currentPath;
      if (import.meta.env.DEV) {
        console.log('[GUARD] Allowing POP (not dirty or no shouldBlock)');
      }
      return;
    }
    
    // shouldBlock returned true - dirty state, check guard
    if (!guard) {
      // No guard function but shouldBlock is true - allow navigation anyway
      lastStableLocationRef.current = currentPath;
      if (import.meta.env.DEV) {
        console.log('[GUARD] Allowing POP (no guard function)');
      }
      return;
    }

    const lastStablePath = lastStableLocationRef.current;
    
    // If location changed via POP, check guard
    if (currentPath !== lastStablePath) {
      const result = guard(currentPath);
      
      // Guard allows navigation (false/null/undefined) - NOT DIRTY
      if (!result) {
        if (import.meta.env.DEV) {
          console.log('[GUARD] allow action=POP (not dirty) from:', lastStablePath, 'to:', currentPath);
        }
        lastStableLocationRef.current = currentPath;
        return;
      }

      // Guard wants to block (dirty=true) - show confirm
      const message = result === true ? 'You have unsaved changes. Are you sure you want to leave?' : result;
      const confirmed = window.confirm(message);

      if (confirmed) {
        // User confirmed, allow the POP navigation
        if (import.meta.env.DEV) {
          console.log('[GUARD] allow (user confirmed) action=POP from:', lastStablePath, 'to:', currentPath);
        }
        lastStableLocationRef.current = currentPath;
      } else {
        // User cancelled, revert URL to match UI
        if (import.meta.env.DEV) {
          console.log('[GUARD] deny (user cancelled) action=POP, reverting to:', lastStablePath);
        }
        isRevertingRef.current = true;
        navigate(lastStablePath, { replace: true });
      }
    } else {
      if (import.meta.env.DEV) {
        console.log('[GUARD] POP navigation but path unchanged, ignoring');
      }
    }
  }, [location, navigate, navigationType]);

  const contextValue = useMemo(() => ({
    registerGuard,
    guardedNavigate,
    isGuardActive,
  }), [registerGuard, guardedNavigate, isGuardActive]);

  return (
    <NavigationGuardContext.Provider value={contextValue}>
      {children}
    </NavigationGuardContext.Provider>
  );
};

export const useNavigationGuard = () => {
  const context = useContext(NavigationGuardContext);
  if (!context) {
    throw new Error('useNavigationGuard must be used within NavigationGuardProvider');
  }
  return context;
};
