import { Bot, Bug, Contrast, MonitorCog, Moon, Plus, Search, Sun, SunDim, Coffee } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useApp, type ThemeName } from "@/lib/app-store";
import { CURRENT_USER } from "@/lib/mock/data";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themeOrder: ThemeName[] = ["light", "dark", "command", "contrast", "lowglare", "warm"];
const themeIcon: Record<ThemeName, typeof Sun> = {
  light: Sun, dark: Moon, command: MonitorCog, contrast: Contrast, lowglare: SunDim, warm: Coffee,
};
const themeLabel: Record<ThemeName, string> = {
  light: "Light", dark: "Dark", command: "Command Center",
  contrast: "High Contrast", lowglare: "Low Glare", warm: "Warm Neutral",
};


export function TopBar() {
  const { setPaletteOpen, setAiOpen, aiOpen, setBugOpen, appearance, setAppearance } = useApp();
  const ThemeIcon = themeIcon[appearance.theme];
  const nextTheme = themeOrder[(themeOrder.indexOf(appearance.theme) + 1) % themeOrder.length]!;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] text-muted-foreground transition-colors hover:border-border-strong"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search customers, quotes, orders, invoices…</span>
        <kbd className="num rounded border border-border px-1 text-[10px]">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5">
              <Plus className="size-4" /> New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild><Link to="/quotes">New Quote</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/orders">New Order</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/customers">New Customer</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/procurement">Receive Material</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm" variant={aiOpen ? "secondary" : "ghost"}
          className="h-8 gap-1.5" onClick={() => setAiOpen(!aiOpen)}
        >
          <Bot className="size-4" /> AI
        </Button>
        <Button
          size="sm" variant="ghost" className="h-8 gap-1.5"
          title={`Theme: ${themeLabel[appearance.theme]} — switch to ${themeLabel[nextTheme]}`}
          aria-label={`Switch theme to ${themeLabel[nextTheme]}`}
          onClick={() => setAppearance({ theme: nextTheme })}
        >
          <ThemeIcon className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => setBugOpen(true)}>
          <Bug className="size-4" /> <span className="hidden lg:inline">Report a Problem</span>
        </Button>

        <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
          <div className="hidden text-right leading-tight md:block">
            <div className="text-[12px] font-medium">{CURRENT_USER.name}</div>
            <div className="text-[10px] text-muted-foreground">{CURRENT_USER.role}</div>
          </div>
          <div className="flex size-7 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">
            {CURRENT_USER.initials}
          </div>
        </div>
      </div>
    </header>
  );
}
