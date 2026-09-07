import { useState } from "react";
import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { FileCheck2, FileText, Home, LogOut, Menu, Package, Receipt, ShoppingBag, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PortalStoreProvider, usePortalStore } from "@/lib/portal/store";
import { account } from "@/lib/portal/data";

export const Route = createFileRoute("/portal")({
  component: () => (
    <PortalStoreProvider>
      <PortalShell />
    </PortalStoreProvider>
  ),
});

const NAV = [
  { to: "/portal", label: "Home", icon: Home, exact: true },
  { to: "/portal/orders", label: "Orders", icon: Package },
  { to: "/portal/shop", label: "Shop", icon: ShoppingBag },
  { to: "/portal/quotes", label: "Quotes", icon: FileText },
  { to: "/portal/proofs", label: "Proofs", icon: FileCheck2 },
  { to: "/portal/invoices", label: "Invoices", icon: Receipt },
  { to: "/portal/account", label: "Account", icon: User },
] as const;

function PortalShell() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { cart } = usePortalStore();

  const isActive = (to: string, exact?: boolean) => (exact ? pathname === to : pathname.startsWith(to));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/portal" className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground">
              HP
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">Hensley Print Co.</span>
              <span className="block truncate text-[12px] leading-tight text-muted-foreground">{account.company}</span>
            </span>
          </Link>

          <nav className="hidden justify-center gap-1 lg:flex">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                  isActive(n.to, "exact" in n ? n.exact : false)
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {cart.length > 0 && (
              <Button size="sm" variant="outline" className="h-8" asChild>
                <Link to="/portal/review">Order draft · {cart.length}</Link>
              </Button>
            )}
            <Button size="sm" className="hidden h-8 sm:inline-flex" asChild>
              <Link to="/portal/shop">Start new order</Link>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-9 lg:hidden"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </div>
        </div>

        {open && (
          <div className="border-t border-border bg-card lg:hidden">
            <nav className="mx-auto grid max-w-6xl gap-1 px-4 py-3 sm:px-6">
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                    isActive(n.to, "exact" in n ? n.exact : false) ? "bg-accent" : "text-muted-foreground",
                  )}
                >
                  <n.icon className="size-4" aria-hidden />
                  {n.label}
                </Link>
              ))}
              <Link
                to="/portal-login"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground"
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </Link>
            </nav>
          </div>
        )}
      </header>

      <main className="pb-24 lg:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom navigation for the five most-used destinations */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card/95 backdrop-blur lg:hidden">
        {NAV.filter((n) => n.label !== "Quotes" && n.label !== "Account").map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={cn(
              "flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
              isActive(n.to, "exact" in n ? n.exact : false) ? "text-primary" : "text-muted-foreground",
            )}
          >
            <n.icon className="size-5" aria-hidden />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
