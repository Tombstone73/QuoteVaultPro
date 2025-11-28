import * as React from "react";
import { SidebarNav } from "./SidebarNav";
import { PageShell } from "@/components/ui/PageShell";

export function AppLayout({ children }: React.PropsWithChildren<{}>) {
  return (
    <div className="flex">
      <SidebarNav />
      <main className="min-h-screen flex-1">
        <PageShell>{children}</PageShell>
      </main>
    </div>
  );
}
