import * as React from "react";
import { cn } from "@/lib/utils";

interface SectionProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export function Section({ title, subtitle, children, className }: SectionProps) {
  return (
    <section className={cn("space-y-4", className)}>
      {(title || subtitle) && (
        <div>
          {title && (
            <h2 className="text-titan-md font-semibold text-titan-text-primary">{title}</h2>
          )}
          {subtitle && (
            <p className="text-titan-sm text-titan-text-muted mt-0.5">{subtitle}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
