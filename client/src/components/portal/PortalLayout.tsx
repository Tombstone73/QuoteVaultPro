import { Outlet } from "react-router-dom";

export function PortalLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar placeholder — will be replaced with PortalSidebar in a later step */}
      <aside className="w-56 shrink-0 border-r bg-card" />

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
