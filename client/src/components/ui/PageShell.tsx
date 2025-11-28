import * as React from "react";

export function PageShell({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--app-shell-bg)" }}>
      <div className={`mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8 md:py-8 ${className || ""}`}>{children}</div>
    </div>
  );
}
