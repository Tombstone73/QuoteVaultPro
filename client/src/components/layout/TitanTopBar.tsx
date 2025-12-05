import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, Bell, Menu, User, ChevronRight, LogOut, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ROUTES } from "@/config/routes";
import { GlobalSearchOverlay } from "./GlobalSearchOverlay";

// ============================================================
// ROUTE TITLE MAPPING
// ============================================================

const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/customers": "Customers",
  "/quotes": "Quotes",
  "/orders": "Orders",
  "/production": "Production Board",
  "/materials": "Materials",
  "/vendors": "Vendors",
  "/purchase-orders": "Purchase Orders",
  "/invoices": "Invoices",
  "/settings": "Settings",
  "/contacts": "Contacts",
  "/products": "Products",
  "/admin": "Admin",
};

function getPageTitle(pathname: string): string {
  // Direct match
  if (ROUTE_TITLES[pathname]) {
    return ROUTE_TITLES[pathname];
  }

  // Check for detail pages (e.g., /customers/123)
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const baseRoute = `/${segments[0]}`;
    const baseTitle = ROUTE_TITLES[baseRoute];
    if (baseTitle) {
      // Check if it's an edit or new page
      if (segments[1] === "new") {
        return `New ${baseTitle.replace(/s$/, "")}`;
      }
      // It's a detail page
      return `${baseTitle.replace(/s$/, "")} Details`;
    }
  }

  // Check for nested routes (e.g., /settings/company)
  for (const [route, title] of Object.entries(ROUTE_TITLES)) {
    if (pathname.startsWith(route)) {
      return title;
    }
  }

  return "TitanOS";
}

function getBreadcrumbs(pathname: string): Array<{ label: string; path: string }> {
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs: Array<{ label: string; path: string }> = [];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const title = ROUTE_TITLES[currentPath];
    if (title) {
      breadcrumbs.push({ label: title, path: currentPath });
    } else if (segment !== "new" && !segment.match(/^[a-f0-9-]{20,}$/i)) {
      // Capitalize segment if it's not a UUID or "new"
      const label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
      breadcrumbs.push({ label, path: currentPath });
    }
  }

  return breadcrumbs;
}

// ============================================================
// TOPBAR COMPONENT
// ============================================================

interface TitanTopBarProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export function TitanTopBar({ onMenuClick, showMenuButton = false }: TitanTopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [showSearchResults, setShowSearchResults] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchContainerRef = React.useRef<HTMLDivElement>(null);

  const { results, isLoading, firstResult } = useGlobalSearch(searchQuery);

  const pageTitle = getPageTitle(location.pathname);
  const breadcrumbs = getBreadcrumbs(location.pathname);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      window.location.href = "/";
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const userInitials = React.useMemo(() => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  }, [user]);

  // Global keyboard shortcut: Ctrl+K / Cmd+K
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearchResults(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close search results when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle search input changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    console.log("[TITAN TOP BAR] Search input changed to:", value);
    setSearchQuery(value);
    setShowSearchResults(value.length >= 2);
    console.log("[TITAN TOP BAR] Show results:", value.length >= 2);
  };

  // Handle search input key presses
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && firstResult) {
      e.preventDefault();
      navigate(firstResult.url);
      setShowSearchResults(false);
      setSearchQuery("");
      searchInputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSearchResults(false);
      searchInputRef.current?.blur();
    }
  };

  // Clear search
  const handleClearSearch = () => {
    setSearchQuery("");
    setShowSearchResults(false);
    searchInputRef.current?.focus();
  };

  // Handle result selection
  const handleResultClick = () => {
    setShowSearchResults(false);
    setSearchQuery("");
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-md md:px-6">
      {/* Left side - Menu button (mobile) + Breadcrumbs/Title */}
      <div className="flex items-center gap-3">
        {showMenuButton && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:hidden"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        {/* Breadcrumbs on larger screens, title on mobile */}
        <div className="hidden md:flex items-center gap-2 text-sm">
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.path}>
              {index > 0 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span
                className={cn(
                  index === breadcrumbs.length - 1
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                )}
                onClick={() => {
                  if (index < breadcrumbs.length - 1) {
                    navigate(crumb.path);
                  }
                }}
              >
                {crumb.label}
              </span>
            </React.Fragment>
          ))}
          {breadcrumbs.length === 0 && (
            <span className="font-semibold text-foreground">{pageTitle}</span>
          )}
        </div>

        {/* Mobile title */}
        <span className="font-semibold text-foreground md:hidden">{pageTitle}</span>
      </div>

      {/* Center - Search (hidden on mobile) */}
      <div className="hidden flex-1 max-w-md mx-8 lg:block">
        <div className="relative" ref={searchContainerRef}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
          <Input
            ref={searchInputRef}
            type="search"
            placeholder="Search... (Ctrl+K)"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
            className="h-9 w-full bg-muted/50 pl-9 pr-9 text-sm placeholder:text-muted-foreground focus:bg-background"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {showSearchResults && (
            <>
              {console.log("[TITAN TOP BAR] Rendering GlobalSearchOverlay with:", { results, isLoading, searchQuery, showSearchResults })}
              <GlobalSearchOverlay
                results={results}
                isLoading={isLoading}
                query={searchQuery}
                onResultClick={handleResultClick}
              />
            </>
          )}
        </div>
      </div>

      {/* Right side - Actions + User */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 gap-2 px-2 hover:bg-muted"
            >
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.profileImageUrl || undefined} />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium text-foreground lg:inline-block">
                {user?.firstName || user?.email || "User"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium text-foreground">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              {user?.role && (
                <p className="text-xs text-muted-foreground capitalize mt-0.5">
                  {user.role}
                </p>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate(ROUTES.settings.root)}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default TitanTopBar;
