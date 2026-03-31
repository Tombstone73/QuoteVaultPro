import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { PortalSidebar } from "@/components/PortalSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { DemoBanner } from "@/components/DemoBanner";
import { DemoPanel } from "@/components/DemoPanel";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <PortalSidebar />

        <div className="flex-1 flex flex-col">
          <DemoBanner />
          <header className="h-14 flex items-center justify-between border-b border-border bg-background px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
            </div>
            <div className="flex items-center gap-3">
              {user && (
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {user.email}
                </span>
              )}
              <Button variant="ghost" size="icon" onClick={logout} title="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>

      <DemoPanel />
    </SidebarProvider>
  );
}
