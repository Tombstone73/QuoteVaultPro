import { WorkspaceTabsProvider, WorkspaceTabBar, WorkspacePanels } from "@/features/workspaces/WorkspaceTabs";
import { WorkspaceEditor } from "@/features/workspaces/WorkspaceEditor";
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from "@/hooks/useAuth";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import * as React from "react";
import { useState, useEffect, Component, ErrorInfo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TitanSidebarNav } from "./TitanSidebarNav";
import { TitanTopBar } from "./TitanTopBar";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RuntimeSafetyWarning } from "@/components/runtime/RuntimeSafetyWarning";
import { AssistantDock, AssistantOverlay, AssistantWorkspaceProvider, useAssistantWorkspace } from "@/features/assistant";

// DIAGNOSTIC: Error boundary to catch route render errors
class RouteErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ROUTE_RENDER_ERROR]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Log but still render the error (don't swallow it)
      return (
        <div className="p-4 text-red-600">
          <h2>Route Render Error</h2>
          <pre>{this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AppLayout() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { activeOrgId, isLoading } = useActiveOrganizationRole();
  const queryClient=useQueryClient();
  const identity=!isLoading && !authLoading && user?.id && activeOrgId && isAuthenticated !== false ? `${user.id}:${activeOrgId}` : null;
  const [readyIdentity,setReadyIdentity]=React.useState<string|null>(null);
  React.useLayoutEffect(()=>{
    if (!identity || identity === readyIdentity) return;
    const business={predicate:(query:{queryKey:readonly unknown[]})=>!['/api/auth/session','/api/me/orgs'].some(path=>String(query.queryKey[0]).endsWith(path))};
    // Cancel/remove previous identity data before any restored editor mounts.
    void queryClient.cancelQueries(business);queryClient.removeQueries(business);
    setReadyIdentity(identity);
  },[identity,readyIdentity,queryClient]);
  if (!identity || readyIdentity !== identity || !user?.id || !activeOrgId) return <div className="p-4 text-sm text-muted-foreground" role="status">Loading workspace…</div>;
  return <AssistantWorkspaceProvider><WorkspaceTabsProvider key={`${user.id}:${activeOrgId}`} scope={{userId:user.id,organizationId:activeOrgId}}><InternalAppLayout /></WorkspaceTabsProvider></AssistantWorkspaceProvider>;
}

function InternalAppLayout() {
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // AppLayout has one viewport-bounded workspace scroll owner: <main>.
  // Route content can be naturally taller than that scrollport, so clip the
  // document/root only while this authenticated shell is mounted.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("app-shell-scroll-lock");
    return () => root.classList.remove("app-shell-scroll-lock");
  }, []);
  
  // DEV-ONLY: Log route changes to verify navigation is working
  useEffect(() => {
    if (import.meta.env?.DEV) {
      console.log('[ROUTE_CHANGE]', location.pathname);
    }
  }, [location.pathname]);

  const orderRightCol = isSidebarCollapsed
    ? "clamp(340px, 24vw, 460px)"
    : "clamp(320px, 22vw, 420px)";

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const showRuntimeSafetyWarning =
    location.pathname === "/admin" ||
    location.pathname.startsWith("/admin/") ||
    location.pathname === "/system/admin" ||
    location.pathname.startsWith("/system/admin/") ||
    location.pathname === "/settings" ||
    location.pathname.startsWith("/settings/");

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-background" data-testid="app-shell">
      {/* Desktop Sidebar */}
      <TitanSidebarNav
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
            onClick={toggleMobileMenu}
          />
          {/* Mobile Sidebar */}
          <div className="fixed left-0 top-0 z-50 h-dvh w-64 md:hidden" data-testid="mobile-navigation-drawer">
            <div className="relative flex h-full min-h-0 flex-col bg-sidebar border-r border-sidebar-border">
              {/* Close button */}
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={toggleMobileMenu}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </Button>
              <TitanSidebarNav isCollapsed={false} mobile />
            </div>
          </div>
        </>
      )}

      {/* Right side: header + page content */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top navigation bar */}
        <TitanTopBar
          onMenuClick={toggleMobileMenu}
          showMenuButton={true}
        />
        <WorkspaceTabBar />
        {showRuntimeSafetyWarning ? <RuntimeSafetyWarning /> : null}

        <AssistantAppContent locationPath={location.pathname} orderRightCol={orderRightCol} />
        <AssistantOverlay />
      </div>
    </div>
  );
}

function AssistantAppContent({ locationPath, orderRightCol }: { locationPath: string; orderRightCol: string }) {
  const { presentation, capabilities } = useAssistantWorkspace();
  const docked = Boolean(capabilities?.enabled && capabilities.conversationsEnabled) && (presentation === "dock_left" || presentation === "dock_right" || presentation === "dock_bottom");
  // The application content viewport is the normal page-level vertical scroll owner.
  const main = (
    <main data-testid="app-main-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-background" style={{ ["--titan-order-right-col" as any]: orderRightCol }}>
      <WorkspacePanels renderEditor={() => <RouteErrorBoundary><WorkspaceEditor /></RouteErrorBoundary>}><div className="flex min-h-full w-full flex-1 flex-col"><RouteErrorBoundary key={locationPath}><Outlet /></RouteErrorBoundary></div></WorkspacePanels>
    </main>
  );
  // Keep the content in the same React position when the Assistant is docked
  // or undocked. Reparenting <main> would unmount every retained editor.
  return <div className={cn("flex min-h-0 min-w-0 flex-1 overflow-hidden", docked && presentation === "dock_bottom" ? "flex-col" : "flex-row")}>
    {docked && presentation === "dock_left" ? <AssistantDock key="left" side="left" /> : null}
    {main}
    {docked && presentation === "dock_right" ? <AssistantDock key="right" side="right" /> : null}
    {docked && presentation === "dock_bottom" ? <AssistantDock key="bottom" side="bottom" /> : null}
  </div>;
}
