import { NavLink, Outlet } from "react-router-dom";
import { FileCheck, Files, FileText, Home, ReceiptText, ShoppingBag } from "lucide-react";

import { usePortalSession } from "@/hooks/usePortal";

const navItems = [
  { to: "/portal", label: "Dashboard", icon: Home, end: true },
  { to: "/portal/invoices", label: "Invoices", icon: ReceiptText },
  { to: "/portal/my-orders", label: "Orders", icon: ShoppingBag },
  { to: "/portal/proofs", label: "Proofs", icon: FileCheck },
  { to: "/portal/my-quotes", label: "Quotes", icon: FileText },
  { to: "/portal/documents", label: "Documents", icon: Files },
];

export function PortalLayout() {
  const { data: session } = usePortalSession();

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 border-r bg-card md:block">
          <div className="border-b px-5 py-5">
            <p className="text-sm font-semibold">Customer Portal</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">{session?.customerName || "Account"}</p>
          </div>
          <nav className="space-y-1 p-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    ].join(" ")
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex gap-2 overflow-x-auto border-b bg-card px-4 py-3 md:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    "whitespace-nowrap rounded-md px-3 py-2 text-sm",
                    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
