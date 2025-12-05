import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  backButton?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, backButton, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-6", className)}>
      <div className="flex items-center gap-4">
        {backButton}
        <div>
          <h1 className="text-titan-xl font-semibold tracking-tight text-titan-text-primary">
            {title}
          </h1>
          {subtitle && (
            <p className="text-titan-sm text-titan-text-muted mt-1">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
