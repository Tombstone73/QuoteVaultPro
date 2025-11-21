import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search, FileText, Building2, User, Package } from "lucide-react";
import { cn } from "@/lib/utils";

type SearchResult = {
  type: "customer" | "quote" | "invoice" | "order";
  id: string;
  title: string;
  subtitle?: string;
  url: string;
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setSearch("");
    }
  }, [open]);

  const { data: results = [], isLoading } = useQuery<SearchResult[]>({
    queryKey: ["/api/search", search],
    queryFn: async () => {
      if (!search || search.length < 2) return [];
      
      const params = new URLSearchParams({ q: search });
      const response = await fetch(`/api/search?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Search failed");
      return response.json();
    },
    enabled: search.length >= 2,
  });

  const handleResultClick = (result: SearchResult) => {
    setLocation(result.url);
    setOpen(false);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "customer": return <Building2 className="w-4 h-4" />;
      case "quote": return <FileText className="w-4 h-4" />;
      case "invoice": return <FileText className="w-4 h-4" />;
      case "order": return <Package className="w-4 h-4" />;
      default: return <Search className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "customer": return "text-blue-500";
      case "quote": return "text-purple-500";
      case "invoice": return "text-green-500";
      case "order": return "text-orange-500";
      default: return "text-gray-500";
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted/50 rounded-md hover:bg-muted transition-colors w-64"
      >
        <Search className="w-4 h-4" />
        <span>Search...</span>
        <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0">
          <div className="flex items-center border-b px-4 py-3">
            <Search className="w-5 h-5 text-muted-foreground mr-2" />
            <Input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies, quotes, invoices, orders..."
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          <div className="max-h-96 overflow-y-auto p-2">
            {isLoading && (
              <div className="text-center py-8 text-muted-foreground">
                Searching...
              </div>
            )}

            {!isLoading && search.length >= 2 && results.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No results found
              </div>
            )}

            {!isLoading && search.length < 2 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Type at least 2 characters to search
              </div>
            )}

            {results.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => handleResultClick(result)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted transition-colors text-left"
              >
                <div className={cn("flex-shrink-0", getTypeColor(result.type))}>
                  {getIcon(result.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{result.title}</div>
                  {result.subtitle && (
                    <div className="text-sm text-muted-foreground truncate">
                      {result.subtitle}
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground capitalize">
                  {result.type}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

