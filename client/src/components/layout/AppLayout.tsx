import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import { TitanSidebarNav } from "./TitanSidebarNav";
import { TitanTopBar } from "./TitanTopBar";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const prevPathRef = useRef<string>(location.pathname + location.search);
  
  // DIAGNOSTIC: Track layout renders
  if (import.meta.env.DEV) {
    console.log('[LAYOUT_RENDER] AppLayout', location.pathname);
  }
  
  // DIAGNOSTIC: Track all route changes globally
  useEffect(() => {
    const to = location.pathname + location.search;
    const from = prevPathRef.current;
    
    if (import.meta.env.DEV) {
      console.log('[ROUTE]', navigationType, from, '->', to);
      
      // Stack trace when navigating from/to product editor
      const isProductEditor = (path: string) => path.includes('/products/') && path.includes('/edit');
      if (isProductEditor(from) || isProductEditor(to)) {
        console.trace('[ROUTE_TRACE] navigation while in product editor');
      }
    }
    
    prevPathRef.current = to;
  }, [location, navigationType]);

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
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
