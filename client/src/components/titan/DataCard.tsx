import * as React from "react";
import { cn } from "@/lib/utils";

interface DataCardProps {
  title?: string;
  description?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function DataCard({ title, description, headerActions, children, className, noPadding }: DataCardProps) {
  const hasHeader = title || description || headerActions;

  return (
    <div className={cn("rounded-xl border border-border/60 bg-card/60 shadow-sm", className)}>
      {hasHeader && (
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            {title && (
              <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {headerActions && (
            <div className="flex items-center gap-2">{headerActions}</div>
          )}
        </div>
      )}
      <div className={noPadding ? "" : "p-6"}>{children}</div>
    </div>
  );
}
