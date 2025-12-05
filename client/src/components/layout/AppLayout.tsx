import * as React from "react";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { TitanSidebarNav } from "./TitanSidebarNav";
import { TitanTopBar } from "./TitanTopBar";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
