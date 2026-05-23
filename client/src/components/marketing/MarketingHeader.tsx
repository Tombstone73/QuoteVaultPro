import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SHIELD_LOGO_SRC } from "@/lib/branding";
import { cn } from "@/lib/utils";

const requestAccessHref = "/support";

type MarketingHeaderProps = {
  activePage?: "home" | "byos";
};

const navItems = [
  { label: "Product", href: "/#features" },
  { label: "Platform", href: "/#solution" },
  { label: "BYOS", href: "/byos" },
  { label: "About", href: "/#about" },
];

export function MarketingHeader({ activePage = "home" }: MarketingHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#05080d]/85 text-white backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-3" aria-label="Printers Hero home">
          <img src={SHIELD_LOGO_SRC} alt="" className="h-9 w-9" aria-hidden="true" />
          <span className="text-base font-semibold tracking-tight">Printers Hero</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Marketing navigation">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm font-medium text-slate-300 transition-colors hover:text-white",
                activePage === "byos" && item.href === "/byos" && "text-[#00a9e0]",
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
            <Link to="/login">Sign In</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="border-0 bg-[#ffd400] text-[#05080d] shadow-[0_0_28px_rgba(255,212,0,0.18)] hover:bg-[#ffe45c]"
          >
            <Link to={requestAccessHref}>Request Access</Link>
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 text-white md:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-white/10 bg-[#05080d] px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-2" aria-label="Mobile marketing navigation">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button asChild variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10">
                <Link to="/login">Sign In</Link>
              </Button>
              <Button asChild className="border-0 bg-[#ffd400] text-[#05080d] hover:bg-[#ffe45c]">
                <Link to={requestAccessHref}>Request Access</Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

export const marketingRequestAccessHref = requestAccessHref;
