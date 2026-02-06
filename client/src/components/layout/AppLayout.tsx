import * as React from "react";
import { useState, useEffect, Component, ErrorInfo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TitanSidebarNav } from "./TitanSidebarNav";
import { TitanTopBar } from "./TitanTopBar";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // DEV-ONLY: Log route changes to verify navigation is working
  useEffect(() => {
    if (import.meta.env.DEV) {
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

  return (
    <div className="flex h-screen w-full bg-background">
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
          <div className="fixed inset-y-0 left-0 z-50 w-64 md:hidden">
            <div className="relative h-full bg-sidebar border-r border-sidebar-border">
              {/* Close button */}
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-3 h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={toggleMobileMenu}
              >
                <X className="h-5 w-5" />
              </Button>
              <TitanSidebarNav isCollapsed={false} />
            </div>
          </div>
        </>
      )}

      {/* Right side: header + page content */}
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        {/* Top navigation bar */}
        <TitanTopBar
          onMenuClick={toggleMobileMenu}
          showMenuButton={true}
        />

        {/* Scrollable page content */}
        <main
          className="flex-1 overflow-y-auto bg-background"
          style={{
            ["--titan-order-right-col" as any]: orderRightCol,
          }}
        >
          <div className="w-full">
            <RouteErrorBoundary>
              <Outlet />
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
