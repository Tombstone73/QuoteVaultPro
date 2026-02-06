import React, { createContext, useContext, useCallback, useRef } from 'react';

/**
 * NavigationGuardContext
 * 
 * Enterprise-safe navigation guard system for BrowserRouter apps.
 * Pages can register a guard function to intercept navigation attempts.
 * 
 * Usage:
 * - ProductEditorPage: registerGuard(() => { if (dirty) return "Unsaved changes!"; })
 * - Sidebar/Nav: Before navigate(), check guard and show confirm if needed
 * 
 * TODO: When migrating to Data Router (RouterProvider + createBrowserRouter),
 * replace this with official useBlocker hook and errorElement boundaries.
 * See: https://reactrouter.com/en/main/hooks/use-blocker
 */

type NavigationGuardFn = (targetPath: string) => string | boolean;

interface NavigationGuardContextValue {
  /**
   * Register a navigation guard function.
   * Returns a cleanup function to unregister.
   * 
   * @param guard - Function that returns:
   *   - false/undefined/null: Allow navigation
   *   - true: Block navigation silently (not recommended)
   *   - string: Block with this message (will show confirm dialog)
   */
  registerGuard: (guard: NavigationGuardFn) => () => void;
  
  /**
   * Check if navigation to targetPath is allowed.
   * Returns true if allowed, false if blocked.
   * Handles confirm dialog automatically if guard returns a message.
   */
  checkNavigation: (targetPath: string) => boolean;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export const NavigationGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const guardRef = useRef<NavigationGuardFn | null>(null);

  const registerGuard = useCallback((guard: NavigationGuardFn) => {
    guardRef.current = guard;
    return () => {
      guardRef.current = null;
    };
  }, []);

  const checkNavigation = useCallback((targetPath: string): boolean => {
    const guard = guardRef.current;
    if (!guard) return true; // No guard registered, allow

    const result = guard(targetPath);
    
    if (!result) return true; // Guard returned false/null/undefined, allow
    if (result === true) return false; // Guard returned true, block silently
    
    // Guard returned string message, show confirm
    return window.confirm(result);
  }, []);

  return (
    <NavigationGuardContext.Provider value={{ registerGuard, checkNavigation }}>
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
