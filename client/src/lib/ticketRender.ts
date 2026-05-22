/**
 * Ticket rendering helpers — pure functions that translate a `TicketFieldFormat`
 * into concrete CSS, plus URL helpers for the ticket route.
 *
 * Kept separate from the page component so the formatting logic that drives the
 * printed ticket can be unit tested without mounting React.
 */

import type { CSSProperties } from "react";
import type { TicketFieldFormat } from "@shared/productionTicket";

/**
 * Print-only stylesheet shared by the ticket and traveler print pages. Isolates
 * the print area (`#ticket-print-area`) and sizes the page for a ~72mm thermal
 * ticket printer (Epson TM-L90).
 */
export const TICKET_PRINT_STYLES = `
@media print {
  body * { visibility: hidden !important; }
  #ticket-print-area, #ticket-print-area * { visibility: visible !important; }
  #ticket-print-area {
    position: absolute; left: 0; top: 0;
    width: 72mm; margin: 0; padding: 0;
  }
  .ticket-no-print { display: none !important; }
  @page { size: 72mm auto; margin: 3mm; }
}
`;

/**
 * Font size in px per template size token. Tuned for thermal readability on an
 * Epson TM-L90 at ~72mm ticket width.
 */
export const TICKET_FONT_SIZE_PX: Record<TicketFieldFormat["fontSize"], number> = {
  small: 9,
  normal: 12,
  large: 16,
  xlarge: 23,
};

/** Resolve a field's format into inline CSS for the ticket value line. */
export function ticketRowStyle(format: TicketFieldFormat): CSSProperties {
  return {
    fontSize: `${TICKET_FONT_SIZE_PX[format.fontSize]}px`,
    fontWeight: format.fontWeight === "bold" ? 700 : 400,
    textAlign: format.align,
    lineHeight: 1.25,
  };
}

/** Build the TitanOS job URL that the ticket QR code points back to. */
export function buildJobTicketQrUrl(origin: string, jobId: string): string {
  const base = (origin || "").replace(/\/+$/, "");
  return `${base}/production/jobs/${jobId}`;
}
