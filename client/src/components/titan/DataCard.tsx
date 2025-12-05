import * as React from "react";
import { cn } from "@/lib/utils";

interface DataCardProps {
  title?: string;
  description?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
  onClick?: () => void;
}

export function DataCard({ title, description, headerActions, children, className, noPadding, onClick }: DataCardProps) {
  const hasHeader = title || description || headerActions;

  return (
    <div 
      className={cn(
        "rounded-titan-xl border border-titan-border-subtle bg-titan-bg-card shadow-titan-card",
        className
      )}
      onClick={onClick}
    >
      {hasHeader && (
        <div className="flex items-center justify-between border-b border-titan-border-subtle px-5 py-4 bg-titan-bg-card-elevated rounded-t-titan-xl">
          <div>
            {title && (
              <h3 className="text-titan-md font-semibold text-titan-text-primary">{title}</h3>
            )}
            {description && (
              <p className="text-titan-sm text-titan-text-muted mt-0.5">{description}</p>
            )}
          </div>
          {headerActions && (
            <div className="flex items-center gap-2">{headerActions}</div>
          )}
        </div>
      )}
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </div>
  );
}
