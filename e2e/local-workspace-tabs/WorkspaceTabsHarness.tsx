import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { WorkspaceTabsProvider, WorkspaceTabBar, WorkspacePanels } from "@/features/workspaces/WorkspaceTabs";
import { WorkspaceEditor } from "@/features/workspaces/WorkspaceEditor";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";

export function WorkspaceTabsHarness() {
  useEffect(() => { document.documentElement.classList.add('app-shell-scroll-lock'); return () => document.documentElement.classList.remove('app-shell-scroll-lock'); }, []);
  const navigate = useNavigate(), { getGuardDiagnostics } = useNavigationGuard();
  Object.assign(window, { __workspaceNavigate: navigate, __workspaceGuards: getGuardDiagnostics });
  return <WorkspaceTabsProvider>
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <nav className="flex h-9 shrink-0 items-center gap-3 border-b px-3 text-xs" aria-label="Fixture navigation">
        <span>Synthetic API — unsaved edits remain in memory</span>
        <button onClick={() => navigate("/orders/existing-a")}>Existing Order A</button>
        <button onClick={() => navigate("/orders/existing-b")}>Existing Order B</button>
        <button onClick={() => navigate("/customers/00000000-0000-4000-8000-000000000004")}>Customer</button>
        <button onClick={() => navigate("/orders")}>Orders list</button>
      </nav>
      <WorkspaceTabBar/>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WorkspacePanels renderEditor={() => <WorkspaceEditor/>}><div>Orders list fixture</div></WorkspacePanels>
      </main>
    </div>
  </WorkspaceTabsProvider>;
}
