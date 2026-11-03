import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { NavigateOptions } from "react-router-dom";
import { useWorkspace, type WorkspaceNavigation } from "./WorkspaceContext";
import type { NavigationGuardDiagnostics, NavigationGuardFn, NavigationGuardTarget } from "./navigationGuardCore";

interface NavigationGuardContextValue {
  registerGuard: (guard: NavigationGuardFn, shouldBlock: () => boolean, label?: string, workspace?: { workspaceId?: string; isWorkspaceActive?: () => boolean }) => () => void;
  guardedNavigate: (to: NavigationGuardTarget, options?: NavigateOptions, workspaceId?: string, navigation?: WorkspaceNavigation) => void;
  isGuardActive: (workspaceId?: string) => boolean;
  getGuardDiagnostics: () => NavigationGuardDiagnostics;
}

export const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export const useOptionalNavigationGuard = () => {
  const context = useContext(NavigationGuardContext);
  const workspace = useWorkspace();
  const owner = useRef(workspace); owner.current = workspace;
  const registerGuard = useCallback((guard: NavigationGuardFn, shouldBlock: () => boolean, label?: string) => context?.registerGuard(guard, shouldBlock, label, {
    workspaceId: owner.current?.id, isWorkspaceActive: () => owner.current?.isActive() ?? true,
  }) ?? (() => {}), [context?.registerGuard, workspace?.id]);
  const guardedNavigate = useCallback((to: NavigationGuardTarget, options?: NavigateOptions) => {
    if (owner.current && !owner.current.isActive() && !owner.current.onNavigate) return;
    if (owner.current?.route && !owner.current.onNavigate) throw new Error("A controlled workspace requires its own navigation callback.");
    context?.guardedNavigate(to, options, owner.current?.id, owner.current?.onNavigate);
  }, [context?.guardedNavigate]);
  return context ? { ...context, registerGuard, guardedNavigate, isGuardActive: (workspaceId = workspace?.id) => context.isGuardActive(workspaceId) } : null;
};
export const useNavigationGuard = () => {
  const context = useOptionalNavigationGuard();
  if (!context) {
    throw new Error("useNavigationGuard must be used within NavigationGuardProvider");
  }
  return context;
};

export function useWorkspaceUnsavedChanges(dirty: boolean, label: string) {
  const guard = useOptionalNavigationGuard();
  const register = guard?.registerGuard;
  useEffect(() => register?.(() => dirty ? "You have unsaved changes. Leave without saving?" : false, () => dirty, label), [register, dirty, label]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
