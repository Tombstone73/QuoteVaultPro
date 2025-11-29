import * as React from "react";

interface SectionProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Section({ title, subtitle, children }: SectionProps) {
  return (
    <section className="space-y-4">
      {(title || subtitle) && (
        <div>
          {title && (
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
