/**
 * Small presentational primitives shared by the production ticket and order
 * traveler print pages.
 */

import type { ReactNode } from "react";

/** Dashed horizontal rule used to separate sections on a thermal ticket. */
export function TicketDivider() {
  return <div style={{ borderTop: "1px dashed #000", margin: "1.5mm 0" }} />;
}

/** Full-screen centered status message (loading / error states). */
export function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
