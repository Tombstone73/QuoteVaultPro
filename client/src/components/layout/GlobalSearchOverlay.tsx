import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Users, User, ShoppingCart, FileText, DollarSign, Briefcase, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GlobalSearchResults, SearchResult } from "@/hooks/useGlobalSearch";

interface GlobalSearchOverlayProps {
  results: GlobalSearchResults;
  isLoading: boolean;
  query: string;
  onResultClick: () => void;
  className?: string;
}

interface SectionConfig {
  key: keyof GlobalSearchResults;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  emptyMessage?: string;
}

const SECTIONS: SectionConfig[] = [
  { key: "customers", label: "Customers", icon: Users },
  { key: "contacts", label: "Contacts", icon: User },
  { key: "orders", label: "Orders", icon: ShoppingCart },
  { key: "quotes", label: "Quotes", icon: FileText },
  { key: "invoices", label: "Invoices", icon: DollarSign },
  { key: "jobs", label: "Jobs", icon: Briefcase },
];

function SearchResultItem({
  result,
  icon: Icon,
  onClick,
}: {
  result: SearchResult;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-3 px-3 py-2 text-left",
        "hover:bg-titan-bg-card-elevated transition-colors rounded-titan-sm",
        "focus:outline-none focus:ring-2 focus:ring-titan-accent/50"
      )}
    >
      <Icon className="h-4 w-4 text-titan-text-muted mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-titan-sm font-medium text-titan-text-primary truncate">
          {result.title}
        </div>
        {result.subtitle && (
          <div className="text-titan-xs text-titan-text-muted truncate mt-0.5">
            {result.subtitle}
          </div>
        )}
      </div>
    </button>
  );
}

function SearchSection({
  section,
  results,
  onResultClick,
}: {
  section: SectionConfig;
  results: SearchResult[];
  onResultClick: (url: string) => void;
}) {
  if (results.length === 0) return null;

  const Icon = section.icon;

  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-titan-text-muted" />
        <span className="text-titan-xs font-semibold text-titan-text-secondary uppercase tracking-wide">
          {section.label}
        </span>
        <span className="text-titan-xs text-titan-text-muted">({results.length})</span>
      </div>
      <div className="space-y-0.5">
        {results.map((result) => (
          <SearchResultItem
            key={result.id}
            result={result}
            icon={Icon}
            onClick={() => onResultClick(result.url)}
          />
        ))}
      </div>
    </div>
  );
}

export function GlobalSearchOverlay({
  results,
  isLoading,
  query,
  onResultClick,
  className,
}: GlobalSearchOverlayProps) {
  const navigate = useNavigate();

  const handleResultClick = (url: string) => {
    navigate(url);
    onResultClick();
  };

  const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
  const hasResults = totalResults > 0;
  
  console.log("[GLOBAL SEARCH OVERLAY] Rendering with:", {
    query,
    isLoading,
    totalResults,
    hasResults,
    customersCount: results?.customers?.length || 0,
    results
  });

  if (isLoading) {
    return (
      <div
        className={cn(
          "absolute top-full left-0 right-0 mt-2 z-50",
          "bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg shadow-titan-card",
          "p-4",
          className
        )}
      >
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-5 w-5 text-titan-text-muted animate-spin" />
          <span className="text-titan-sm text-titan-text-muted">Searching...</span>
        </div>
      </div>
    );
  }

  if (!query || query.length < 2) {
    return null;
  }

  if (!hasResults) {
    return (
      <div
        className={cn(
          "absolute top-full left-0 right-0 mt-2 z-50",
          "bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg shadow-titan-card",
          "p-4",
          className
        )}
      >
        <div className="text-center py-8">
          <FileText className="h-8 w-8 text-titan-text-muted mx-auto mb-2" />
          <p className="text-titan-sm font-medium text-titan-text-primary">No results found</p>
          <p className="text-titan-xs text-titan-text-muted mt-1">
            No matches for "{query}"
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "absolute top-full left-0 right-0 mt-2 z-50",
        "bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg shadow-titan-card",
        "max-h-[500px] overflow-y-auto",
        "p-3",
        className
      )}
    >
      <div className="mb-2 px-3 py-1">
        <span className="text-titan-xs text-titan-text-muted">
          Found {totalResults} result{totalResults !== 1 ? "s" : ""} for "{query}"
        </span>
      </div>
      {SECTIONS.map((section) => (
        <SearchSection
          key={section.key}
          section={section}
          results={results[section.key]}
          onResultClick={handleResultClick}
        />
      ))}
    </div>
  );
}
