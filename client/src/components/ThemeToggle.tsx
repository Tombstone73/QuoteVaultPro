import * as React from "react";
import { Moon, Sun, MonitorDot, Contrast } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemeId } from "@/hooks/useTheme";

const THEME_ICONS: Record<ThemeId, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  command: MonitorDot,
  "high-contrast": Contrast,
};

export function ThemeToggle() {
  const { theme, setTheme, availableThemes, getMeta } = useTheme();
  const CurrentIcon = THEME_ICONS[theme] || Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <CurrentIcon className="h-4 w-4" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {availableThemes.map((themeId) => {
          const meta = getMeta(themeId);
          const Icon = THEME_ICONS[themeId];
          return (
            <DropdownMenuItem
              key={themeId}
              onClick={() => setTheme(themeId)}
              className="flex items-center gap-2"
            >
              <Icon className="h-4 w-4" />
              <span>{meta?.label || themeId}</span>
              {theme === themeId && <span className="ml-auto text-xs">✓</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
