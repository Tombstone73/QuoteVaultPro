/**
 * Ticket settings — station-level persistence for the production ticket
 * printing MVP.
 *
 * For go-live this is deliberately stored in `localStorage` (per browser /
 * station) rather than the database:
 *  - A "station" maps naturally to one physical machine + browser.
 *  - It avoids a schema migration on the go-live path.
 *
 * Both the printer preference and the ticket template are stored as plain JSON
 * so a future server-backed settings screen / visual template editor can adopt
 * the same shapes without changing the rendering contract.
 */

import {
  DEFAULT_TICKET_TEMPLATE,
  TICKET_FIELD_ORDER,
  type TicketTemplate,
} from "@shared/productionTicket";

const PRINTER_KEY = "titanos.ticketPrinters.v1";
const TEMPLATE_KEY = "titanos.ticketTemplate.v1";

export interface TicketPrinterPrefs {
  /** Printer names the operator has saved on this station. */
  printers: string[];
  /** Preferred default printer name (must be one of `printers`), or null. */
  defaultPrinter: string | null;
}

const EMPTY_PRINTER_PREFS: TicketPrinterPrefs = { printers: [], defaultPrinter: null };

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadPrinterPrefs(): TicketPrinterPrefs {
  if (typeof window === "undefined") return { ...EMPTY_PRINTER_PREFS };
  const parsed = safeParse<TicketPrinterPrefs>(window.localStorage.getItem(PRINTER_KEY));
  if (!parsed || !Array.isArray(parsed.printers)) return { ...EMPTY_PRINTER_PREFS };
  const printers = parsed.printers.filter((p): p is string => typeof p === "string" && !!p.trim());
  const defaultPrinter =
    typeof parsed.defaultPrinter === "string" && printers.includes(parsed.defaultPrinter)
      ? parsed.defaultPrinter
      : null;
  return { printers, defaultPrinter };
}

export function savePrinterPrefs(prefs: TicketPrinterPrefs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRINTER_KEY, JSON.stringify(prefs));
}

/**
 * Load the station ticket template, merged over the default so that newly
 * added fields always have a valid format even if an old template is stored.
 */
export function loadTicketTemplate(): TicketTemplate {
  if (typeof window === "undefined") return DEFAULT_TICKET_TEMPLATE;
  const parsed = safeParse<TicketTemplate>(window.localStorage.getItem(TEMPLATE_KEY));
  if (!parsed || !parsed.fields) return DEFAULT_TICKET_TEMPLATE;

  const fields = { ...DEFAULT_TICKET_TEMPLATE.fields };
  for (const key of TICKET_FIELD_ORDER) {
    const stored = parsed.fields[key];
    if (stored) fields[key] = { ...DEFAULT_TICKET_TEMPLATE.fields[key], ...stored };
  }
  return { version: DEFAULT_TICKET_TEMPLATE.version, fields };
}

export function saveTicketTemplate(template: TicketTemplate): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(template));
}
