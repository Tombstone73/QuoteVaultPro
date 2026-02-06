import React, { createContext, useContext, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

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
  registerGuard: (guard: NavigationGuardFn) => () => void;
  guardedNavigate: (to: string) => void;
  isGuardActive: () => boolean; // Check if guard would block
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export const NavigationGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const guardRef = useRef<NavigationGuardFn | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const lastStableLocationRef = useRef<string>(location.pathname + location.search);
  const isRevertingRef = useRef<boolean>(false);

  const registerGuard = useCallback((guard: NavigationGuardFn) => {
    guardRef.current = guard;
    return () => {
      guardRef.current = null;
    };
  }, []);

  // Check if guard would currently block navigation
  const isGuardActive = useCallback(() => {
    const guard = guardRef.current;
    if (!guard) return false;
    
    // Call guard with empty string to check if it would block any navigation
    const result = guard('');
    return !!result; // Returns true if guard would block (truthy result)
  }, []);

  // Guarded navigate for PUSH navigation (sidebar clicks, programmatic nav)
  const guardedNavigate = useCallback((to: string) => {
    const guard = guardRef.current;
    
    if (import.meta.env.DEV) {
      console.log('[GUARD] guardedNavigate called', { to, hasGuard: !!guard });
    }
    
    // No guard registered, allow navigation
    if (!guard) {
      if (import.meta.env.DEV) {
        console.log('[GUARD] allow (no guard) action=PUSH to:', to);
      }
      navigate(to);
      return;
    }

    const result = guard(to);
    
    if (import.meta.env.DEV) {
      console.log('[GUARD] guard returned', { to, result, resultType: typeof result });
    }
    
    // Guard returned false/null/undefined, allow navigation
    if (!result) {
      if (import.meta.env.DEV) {
        console.log('[GUARD] allow (guard returned false) action=PUSH to:', to);
      }
      navigate(to);
      return;
    }

    // Guard returned true, block silently
    if (result === true) {
      if (import.meta.env.DEV) {
        console.log('[GUARD] deny (silent) action=PUSH to:', to);
      }
      return;
    }

    // Guard returned string message, show confirm
    const confirmed = window.confirm(result);
    if (confirmed) {
      if (import.meta.env.DEV) {
        console.log('[GUARD] allow (user confirmed) action=PUSH to:', to);
      }
      navigate(to);
    } else {
      if (import.meta.env.DEV) {
        console.log('[GUARD] deny (user cancelled) action=PUSH to:', to);
      }
    }
  }, [navigate]);

  // Handle browser back/forward (POP navigation)
  // Only intercepts when guard is active (dirty=true)
  useEffect(() => {
    const currentPath = location.pathname + location.search;
    
    // Skip guard logic if we're currently reverting a POP to avoid recursion
    if (isRevertingRef.current) {
      isRevertingRef.current = false;
      lastStableLocationRef.current = currentPath;
      return;
    }

    const guard = guardRef.current;
    
    // No guard registered, track stable location and allow
    if (!guard) {
      lastStableLocationRef.current = currentPath;
      return;
    }

    const lastStablePath = lastStableLocationRef.current;
    
    // If location changed, this is a POP navigation attempt
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
    }
  }, [location, navigate]);

  return (
    <NavigationGuardContext.Provider value={{ registerGuard, guardedNavigate, isGuardActive }}>
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
