import * as React from "react";
import { Search } from "lucide-react";

interface FilterPanelProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export function FilterPanel({ title, description, children }: FilterPanelProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 shadow-sm">
      {(title || description) && (
        <div className="border-b border-border/60 px-6 py-4">
          {title && (
            <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Search className="h-5 w-5" />
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      )}
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}
