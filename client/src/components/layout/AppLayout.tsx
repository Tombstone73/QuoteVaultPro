import * as React from "react";
import { Outlet } from "react-router-dom";
import { SidebarNav } from "./SidebarNav";
import { PageShell } from "@/components/ui/PageShell";

export function AppLayout() {
  return (
    <div className="flex h-screen w-full">
      {/* Left sidebar */}
      <SidebarNav />

      {/* Right side: header + page content */}
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        {/* Command bar across the top */}
        <header className="sticky top-0 z-20 flex h-12 items-center justify-center border-b border-border/60 bg-background/90 text-[10px] font-medium uppercase tracking-[0.25em] backdrop-blur-md">
          TitanOS Command Station
        </header>

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto">
          <PageShell>
            <Outlet />
          </PageShell>
        </main>
      </div>
    </div>
  );
}
