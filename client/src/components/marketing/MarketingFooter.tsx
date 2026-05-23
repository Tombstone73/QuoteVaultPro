import { Link } from "react-router-dom";
import { SHIELD_LOGO_SRC } from "@/lib/branding";

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#05080d] py-10 text-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:px-6 md:flex-row lg:px-8">
        <Link to="/" className="flex items-center gap-3">
          <img src={SHIELD_LOGO_SRC} alt="" className="h-8 w-8" aria-hidden="true" />
          <span className="font-semibold">Printers Hero</span>
        </Link>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
          <a href="/#features" className="transition-colors hover:text-white">Product</a>
          <a href="/#solution" className="transition-colors hover:text-white">Platform</a>
          <Link to="/byos" className="transition-colors hover:text-white">BYOS</Link>
          <a href="/#about" className="transition-colors hover:text-white">About</a>
          <Link to="/support" className="transition-colors hover:text-white">Support</Link>
        </nav>

        <div className="text-sm text-slate-500">
          &copy; {new Date().getFullYear()} Printers Hero. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
