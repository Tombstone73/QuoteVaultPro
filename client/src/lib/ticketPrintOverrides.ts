/**
 * Ticket print-snapshot overrides.
 *
 * The Print Options modal lets an operator adjust ticket-specific print values
 * (destination, quantity display, note, station/route, fulfillment, reason)
 * for a single print run. These are passed to the ticket render route as URL
 * query params and applied as a *print snapshot only* — they never mutate the
 * underlying order/job data.
 *
 * This module is pure (no React) so the param round-trip is unit testable.
 */

export type TicketReason = "standard" | "completion" | "partial" | "reprint";

export type TicketQuantityMode = "default" | "partial";

export interface TicketPrintOverrides {
  /** Reason/type for this print run. Drives the ticket banner + print log. */
  reason: TicketReason;
  /** Printer destination label (guides the operator in the print dialog). */
  destination?: string;
  /** Quantity display mode. */
  quantityMode: TicketQuantityMode;
  /** Completed quantity (partial mode). */
  quantityDone?: number;
  /** Total quantity (partial mode). */
  quantityTotal?: number;
  /** Ad-hoc print-only note. */
  note?: string;
  /** Station / route override (e.g. "Flatbed"). */
  stationRoute?: string;
  /** Fulfillment override (e.g. "Pickup"). */
  fulfillment?: string;
}

const VALID_REASONS: ReadonlySet<string> = new Set([
  "standard",
  "completion",
  "partial",
  "reprint",
]);

/** A no-override default — used for the fast "Print Ticket" path. */
export const DEFAULT_TICKET_OVERRIDES: TicketPrintOverrides = {
  reason: "standard",
  quantityMode: "default",
};

function toFiniteInt(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/**
 * Format a partial quantity as "<done> of <total>" (e.g. "150 of 200").
 * Returns "" when the inputs are not a usable pair.
 */
export function formatQuantityDisplay(
  done: number | undefined,
  total: number | undefined,
): string {
  if (!Number.isFinite(done) || !Number.isFinite(total)) return "";
  if ((total as number) <= 0) return "";
  return `${done} of ${total}`;
}

/** Resolve the quantity string a ticket should show, given overrides. */
export function resolveQuantityDisplay(
  overrides: TicketPrintOverrides,
  actualQuantity: number,
): string {
  if (overrides.quantityMode === "partial") {
    const done = overrides.quantityDone;
    const total = overrides.quantityTotal ?? actualQuantity;
    const display = formatQuantityDisplay(done, total);
    if (display) return display;
  }
  return Number.isFinite(actualQuantity) ? String(actualQuantity) : "";
}

/** Parse ticket print overrides from a route's URLSearchParams. */
export function parseTicketOverrides(params: URLSearchParams): TicketPrintOverrides {
  const reasonParam = (params.get("reason") || "").toLowerCase();
  // Back-compat: the completion prompt used `?completion=1` before `reason`.
  const legacyCompletion = params.get("completion") === "1";
  const reason: TicketReason = VALID_REASONS.has(reasonParam)
    ? (reasonParam as TicketReason)
    : legacyCompletion
      ? "completion"
      : "standard";

  const quantityMode: TicketQuantityMode =
    (params.get("qtyMode") || "").toLowerCase() === "partial" ? "partial" : "default";

  return {
    reason,
    destination: params.get("dest")?.trim() || undefined,
    quantityMode,
    quantityDone: toFiniteInt(params.get("qtyDone")),
    quantityTotal: toFiniteInt(params.get("qtyTotal")),
    note: params.get("note")?.trim() || undefined,
    stationRoute: params.get("route")?.trim() || undefined,
    fulfillment: params.get("fulfillment")?.trim() || undefined,
  };
}

/**
 * Serialize ticket print overrides into a query string (without the leading
 * "?"). Default/empty values are omitted to keep the fast path URL clean.
 */
export function serializeTicketOverrides(overrides: TicketPrintOverrides): string {
  const params = new URLSearchParams();
  if (overrides.reason && overrides.reason !== "standard") {
    params.set("reason", overrides.reason);
  }
  if (overrides.destination) params.set("dest", overrides.destination);
  if (overrides.quantityMode === "partial") {
    params.set("qtyMode", "partial");
    if (Number.isFinite(overrides.quantityDone)) {
      params.set("qtyDone", String(overrides.quantityDone));
    }
    if (Number.isFinite(overrides.quantityTotal)) {
      params.set("qtyTotal", String(overrides.quantityTotal));
    }
  }
  if (overrides.note) params.set("note", overrides.note);
  if (overrides.stationRoute) params.set("route", overrides.stationRoute);
  if (overrides.fulfillment) params.set("fulfillment", overrides.fulfillment);
  return params.toString();
}

/** Banner text shown on the printed ticket for non-standard print reasons. */
export function ticketReasonBanner(reason: TicketReason): string | null {
  switch (reason) {
    case "completion":
      return "✓ COMPLETED";
    case "partial":
      return "◑ PARTIAL COMPLETION";
    case "reprint":
      return "↻ REPRINT";
    default:
      return null;
  }
}
