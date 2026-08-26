/**
 * Ticket rendering helpers — pure functions that translate a `TicketFieldFormat`
 * into concrete CSS, plus URL helpers for the ticket route.
 *
 * Kept separate from the page component so the formatting logic that drives the
 * printed ticket can be unit tested without mounting React.
 */

import type { CSSProperties } from "react";
import type { TicketFieldFormat } from "@shared/productionTicket";

export const THERMAL_PRINT_AREA_ID = "ticket-print-area";
export const THERMAL_PAPER_WIDTH = "80mm";
export const THERMAL_PAGE_PADDING = "3mm";
export const THERMAL_FEED_SPACER_DEFAULT = "1.5in";

/**
 * Print-only stylesheet shared by linerless thermal ticket pages. Isolates the
 * print area (`#ticket-print-area`) and sizes the page for an Epson TM-L90
 * class receipt printer. Normal app pages and letter-size PDFs are unaffected.
 */
export const THERMAL_PRINT_STYLES = `
@media print {
  @page { size: 80mm auto; margin: 0; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body * { visibility: hidden !important; }
  #ticket-print-area, #ticket-print-area * { visibility: visible !important; }
  #ticket-print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 80mm !important;
    margin: 0 !important;
    padding: 3mm !important;
    box-sizing: border-box !important;
    background: #fff !important;
    color: #000 !important;
    font-family: Arial, Helvetica, sans-serif !important;
  }
  #ticket-print-area * {
    color: #000 !important;
    text-shadow: none !important;
    box-shadow: none !important;
  }
  .thermal-feed-spacer {
    display: block !important;
    height: var(--thermal-feed-spacer, 1.5in) !important;
    min-height: var(--thermal-feed-spacer, 1.5in) !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .ticket-no-print { display: none !important; }
}
`;

export const TICKET_PRINT_STYLES = THERMAL_PRINT_STYLES;

/**
 * Font size in px per template size token. Tuned for thermal readability on an
 * Epson TM-L90 at 80mm ticket width.
 */
export const TICKET_FONT_SIZE_PX: Record<TicketFieldFormat["fontSize"], number> = {
  small: 12,
  normal: 15,
  large: 20,
  xlarge: 26,
};

/** Resolve a field's format into inline CSS for the ticket value line. */
export function ticketRowStyle(format: TicketFieldFormat): CSSProperties {
  return {
    fontSize: `${TICKET_FONT_SIZE_PX[format.fontSize]}px`,
    fontWeight: format.fontWeight === "bold" ? 800 : 700,
    textAlign: format.align,
    lineHeight: 1.12,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    color: "#000",
  };
}

/** Build the TitanOS job URL that the ticket QR code points back to. */
export function buildJobTicketQrUrl(origin: string, jobId: string): string {
  const base = (origin || "").replace(/\/+$/, "");
  return `${base}/production/jobs/${jobId}`;
}
