import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WorkspaceNavigation } from "./WorkspaceContext";
import { NavigationGuardContext } from "./navigationGuardRegistration";
export { useNavigationGuard, useOptionalNavigationGuard, useWorkspaceUnsavedChanges } from "./navigationGuardRegistration";
import { useLocation, useNavigate, type NavigateOptions } from "react-router-dom";
import {
  notifyBrowserRouterOfCurrentUrlSoon,
  recoverBrowserRouterMismatchSoon,
} from "@/lib/nav/browserRouterSync";
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

export const NavigationGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const registryRef = useRef(createNavigationGuardRegistry());
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const [exit, setExit] = useState<{ workspaceId?: string; resolve: (allowed: boolean) => void; busy: boolean; saved?: boolean; error?: string } | null>(null);
  const exitPromise = useRef<Promise<boolean> | null>(null);
  const finishExit = (allowed: boolean) => { exit?.resolve(allowed); exitPromise.current = null; setExit(null); };
  const requestExit = useCallback((workspaceId?: string): boolean | Promise<boolean> => {
    const blocking = registryRef.current.getBlockingEntries(workspaceId);
    if (!blocking.length) return true;
    if (exitPromise.current) return exitPromise.current;
    if (!blocking.every(entry=>entry.save)) return window.confirm('Unsaved changes will be lost. Discard Changes and continue? Cancel to stay and save your work.');
    const promise = new Promise<boolean>(resolve => setExit({workspaceId,resolve,busy:false}));
    exitPromise.current = promise; return promise;
  }, []);
  const saveAndContinue = async () => {
    if (!exit || exit.busy) return;
    setExit({...exit,busy:true,error:undefined});
    try {
      for (const entry of registryRef.current.getBlockingEntries(exit.workspaceId)) {
        if (!entry.save) throw new Error('Save the remaining edits in their editor before continuing.');
        await entry.save();
      }
      // Decide after React commits the new baseline and any concurrent edits.
      setExit({...exit,busy:false,saved:true});
    } catch (error) { setExit({...exit,busy:false,error:error instanceof Error ? error.message : 'Save failed. Your edits are retained.'}); }
  };

  useEffect(()=>{
    if (!exit?.saved) return;
    if (registryRef.current.isGuardActive(exit.workspaceId)) setExit({...exit,saved:false,error:'Newer unsaved edits remain. Review and save them before continuing.'});
    else finishExit(true);
  },[exit?.saved]);

  const registerGuard = useCallback((guard: NavigationGuardFn, shouldBlock: () => boolean, label?: string, workspace?: { workspaceId?: string; isWorkspaceActive?: () => boolean; save?: () => Promise<void> }) => {
    const unregister = registryRef.current.registerGuard(guard, shouldBlock, label, workspace);
    const entries = registryRef.current.getEntries();
    const guardId = entries[entries.length - 1]?.id;

    if (import.meta.env?.DEV) {
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

      if (import.meta.env?.DEV) {
        console.log("[NavigationGuard] unregistered", {
          guardId,
          label: label ?? "anonymous",
          guardCount: remainingEntries.length,
          windowPath: window.location.pathname,
        });
      }
    };
  }, []);

  const isGuardActive = useCallback((workspaceId?: string) => {
    return registryRef.current.isGuardActive(workspaceId);
  }, []);

  const getGuardDiagnostics = useCallback(() => {
    return registryRef.current.getDiagnostics();
  }, []);

  const guardedNavigate = useCallback(
    (to: NavigationGuardTarget, options?: NavigateOptions, workspaceId?: string, navigation?: WorkspaceNavigation) => {
      const origin = typeof window === "undefined" ? undefined : window.location.origin;
      const decision = registryRef.current.decideNavigation(to, (message) => window.confirm(message), origin, workspaceId);

      if (import.meta.env?.DEV) {
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
        if (import.meta.env?.DEV) {
          console.log("[NavigationGuard] navigation denied before URL change", {
            guardId: decision.blockedGuardId,
            targetPath: decision.targetPath,
            windowPath: window.location.pathname,
            reactRouterPath: location.pathname,
          });
        }
        return;
      }

      if (import.meta.env?.DEV) {
        console.log("[NavigationGuard] navigation allowed", {
          targetPath: decision.targetPath,
          windowPath: window.location.pathname,
          reactRouterPath: location.pathname,
        });
      }

      if (navigation) { void navigation(to, options); return; }
      if (typeof to === "number") {
        navigate(to);
      } else {
        navigate(to, options);
        notifyBrowserRouterOfCurrentUrlSoon();
        recoverBrowserRouterMismatchSoon({
          targetPath: decision.targetPath,
          getReactRouterPath: () =>
            `${locationRef.current.pathname}${locationRef.current.search}${locationRef.current.hash}`,
        });
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
      subscribeGuards: registryRef.current.subscribeGuards,
      notifyGuardChanged: registryRef.current.notifyGuardChanged,
      requestExit,
    }),
    [registerGuard, guardedNavigate, isGuardActive, getGuardDiagnostics, requestExit],
  );

  return (
    <NavigationGuardContext.Provider value={contextValue}>
      {children}
      <Dialog open={Boolean(exit)} onOpenChange={open=>{if (!open && !exit?.busy) finishExit(false);}}><DialogContent>
        <DialogHeader><DialogTitle>Unsaved changes</DialogTitle><DialogDescription>Save your changes before leaving, or deliberately discard them.</DialogDescription></DialogHeader>
        {exit?.error && <p role="alert" className="text-sm text-destructive">{exit.error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={exit?.busy} onClick={()=>finishExit(false)}>Stay</Button><Button variant="destructive" disabled={exit?.busy} onClick={()=>finishExit(true)}>Discard Changes</Button><Button disabled={exit?.busy} onClick={()=>void saveAndContinue()}>{exit?.busy ? 'Saving…' : 'Save and Continue'}</Button></div>
      </DialogContent></Dialog>
    </NavigationGuardContext.Provider>
  );
};
