import * as React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileCheck,
  Files,
  FileText,
  Home,
  Loader2,
  LogOut,
  Moon,
  ReceiptText,
  ShoppingBag,
  Sun,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyThemeClass, useTheme, type ThemeId } from "@/hooks/useTheme";
import { usePortalSession } from "@/hooks/usePortal";
import {
  getNextPortalAuthSessionState,
  portalLogoutRedirectPath,
  portalNavItems,
  readPortalTheme,
  writePortalTheme,
  type PortalAuthSessionState,
  type PortalThemeId,
} from "@/lib/portalShell";
import { getApiUrl } from "@/lib/apiConfig";
import { apiFetch } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";

const NAV_ICONS = {
  home: Home,
  quotes: FileText,
  orders: ShoppingBag,
  proofs: FileCheck,
  invoices: ReceiptText,
  documents: Files,
};

function getStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function getInitialPortalTheme(appTheme: ThemeId): PortalThemeId {
  return readPortalTheme(getStorage()) ?? (appTheme === "dark" ? "dark" : "light");
}

function PortalThemeToggle({
  theme,
  onThemeChange,
}: {
  theme: PortalThemeId;
  onThemeChange: (theme: PortalThemeId) => void;
}) {
  const CurrentIcon = theme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-9 gap-2 px-2.5">
          <CurrentIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Theme</span>
          <span className="sr-only">Change portal theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onThemeChange("light")} className="flex items-center gap-2">
          <Sun className="h-4 w-4" />
          <span>Light</span>
          {theme === "light" ? <span className="ml-auto text-xs">Selected</span> : null}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onThemeChange("dark")} className="flex items-center gap-2">
          <Moon className="h-4 w-4" />
          <span>Dark</span>
          {theme === "dark" ? <span className="ml-auto text-xs">Selected</span> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PortalLayout() {
  const { data: session } = usePortalSession();
  const queryClient = useQueryClient();
  const { theme: appTheme } = useTheme();
  const staffPreview = session?.staffPreview?.active ? session.staffPreview : null;
  const [portalAuthState, setPortalAuthState] = React.useState<PortalAuthSessionState>("authenticated_active");
  const [portalTheme, setPortalTheme] = React.useState<PortalThemeId>(() => getInitialPortalTheme(appTheme));
  const appThemeRef = React.useRef(appTheme);

  React.useEffect(() => {
    appThemeRef.current = appTheme;
  }, [appTheme]);

  React.useEffect(() => {
    applyThemeClass(portalTheme);
    return () => applyThemeClass(appThemeRef.current);
  }, [portalTheme]);

  const handlePortalThemeChange = React.useCallback((nextTheme: PortalThemeId) => {
    writePortalTheme(getStorage(), nextTheme);
    setPortalTheme(nextTheme);
  }, []);

  const exitPreviewMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/portal/preview/end");
      return response.json() as Promise<{ success: boolean; data?: { returnTo?: string } }>;
    },
    onSuccess: (payload) => {
      queryClient.removeQueries({ queryKey: ["portal", "me"] });
      window.location.href = payload.data?.returnTo || staffPreview?.returnTo || "/customers";
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(getApiUrl("/api/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    },
    onMutate: () => {
      setPortalAuthState((state) => getNextPortalAuthSessionState(state, "logout_requested"));
    },
    onSettled: () => {
      setPortalAuthState((state) => getNextPortalAuthSessionState(state, "logout_completed"));
      queryClient.clear();
      window.location.href = portalLogoutRedirectPath;
    },
  });

  const logoutPending = portalAuthState === "logging_out" || logoutMutation.isPending;
  const showCustomerLogout = !staffPreview;

  const renderLogoutButton = () =>
    showCustomerLogout ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 gap-2"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutPending}
      >
        {logoutPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        <span>Log out</span>
      </Button>
    ) : null;

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-border/80 bg-card/95 md:flex md:flex-col">
          <div className="border-b border-border/80 px-5 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Home className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-semibold">Customer Portal</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">{session?.customerName || "Account"}</p>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {portalNavItems.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    ].join(" ")
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="space-y-3 border-t border-border/80 p-4">
            <PortalThemeToggle theme={portalTheme} onThemeChange={handlePortalThemeChange} />
            {renderLogoutButton()}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {staffPreview && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950">
              <div className="font-medium">
                Staff previewing customer portal for {session?.customerName || "this customer"}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 border-amber-400 bg-white/80 text-amber-950 hover:bg-white"
                onClick={() => exitPreviewMutation.mutate()}
                disabled={exitPreviewMutation.isPending}
              >
                <LogOut className="mr-1.5 h-4 w-4" />
                Exit Preview
              </Button>
            </div>
          )}
          <header className="border-b border-border/80 bg-card/95 md:hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Customer Portal</p>
                <p className="truncate text-xs text-muted-foreground">{session?.customerName || "Account"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <PortalThemeToggle theme={portalTheme} onThemeChange={handlePortalThemeChange} />
                {renderLogoutButton()}
              </div>
            </div>
            <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
              {portalNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    ].join(" ")
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </header>
          <main className="flex-1 overflow-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
