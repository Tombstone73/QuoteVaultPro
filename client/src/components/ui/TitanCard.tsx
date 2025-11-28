import * as React from "react";

export function TitanCard({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`rounded-xl border backdrop-blur-sm ${className || ""}`}
      style={{
        background: "linear-gradient(to bottom right, var(--app-card-gradient-start), var(--app-card-gradient-end))",
        borderColor: "var(--app-card-border-color)",
        boxShadow: "var(--app-card-shadow)"
      }}
    >
      {children}
    </div>
  );
}
