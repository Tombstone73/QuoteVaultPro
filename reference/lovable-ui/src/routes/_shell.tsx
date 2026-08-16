import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Sidebar } from "@/components/app/Sidebar";
import { TopBar } from "@/components/app/TopBar";
import { AiPanel } from "@/components/app/AiPanel";
import { CommandPalette } from "@/components/app/CommandPalette";
import { BugDialog } from "@/components/app/BugDialog";

export const Route = createFileRoute("/_shell")({
  component: AppShell,
});

function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
          <AiPanel />
        </div>
      </div>
      <CommandPalette />
      <BugDialog />
    </div>
  );
}
