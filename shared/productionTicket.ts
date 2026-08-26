/**
 * Production Ticket — shared template structure + data mapping.
 *
 * This module is intentionally framework-free so it can be unit tested and
 * reused by both the ticket print page and a future visual template editor.
 *
 * MVP scope:
 *  - A `TicketTemplate` describes, per field: show/hide, display order,
 *    label override, font size, font weight, alignment, and dividers.
 *  - `buildTicketData()` maps raw job/order/line-item data + a template into
 *    an ordered list of `TicketRow`s ready to render.
 *
 * The template is stored as plain JSON so a drag-and-drop editor can be layered
 * on later without changing the rendering contract.
 */

export type TicketFontSize = "small" | "normal" | "large" | "xlarge";
export type TicketFontWeight = "normal" | "bold";
export type TicketAlign = "left" | "center" | "right";

/** Stable identifiers for every field a ticket can render. */
export type TicketFieldKey =
  | "orderNumber"
  | "rush"
  | "poNumber"
  | "customerName"
  | "contactName"
  | "fulfillment"
  | "stationRoute"
  | "assignedTo"
  | "dueDate"
  | "description"
  | "quantity"
  | "size"
  | "material"
  | "productionNotes"
  | "internalNotes"
  | "ticketNote"
  | "jobId";

/** Per-field formatting + visibility. A future editor writes this object. */
export interface TicketFieldFormat {
  show: boolean;
  /** Display order (ascending). Ties broken by the canonical field order. */
  order: number;
  /** Overrides the default human label when non-empty. */
  labelOverride?: string | null;
  fontSize: TicketFontSize;
  fontWeight: TicketFontWeight;
  align: TicketAlign;
  dividerBefore: boolean;
  dividerAfter: boolean;
}

/** The full ticket template — versioned for forward-compatible migrations. */
export interface TicketTemplate {
  version: number;
  fields: Record<TicketFieldKey, TicketFieldFormat>;
}

/** Canonical ordering used to break ties and to iterate fields. */
export const TICKET_FIELD_ORDER: TicketFieldKey[] = [
  "rush",
  "orderNumber",
  "poNumber",
  "customerName",
  "contactName",
  "fulfillment",
  "stationRoute",
  "assignedTo",
  "dueDate",
  "description",
  "quantity",
  "size",
  "material",
  "productionNotes",
  "internalNotes",
  "ticketNote",
  "jobId",
];

/** Default human-readable labels (overridable per template field). */
export const TICKET_FIELD_LABELS: Record<TicketFieldKey, string> = {
  orderNumber: "Order #",
  rush: "Rush",
  poNumber: "PO #",
  customerName: "Customer",
  contactName: "Contact",
  fulfillment: "Fulfillment",
  stationRoute: "Station / Route",
  assignedTo: "Assigned To",
  dueDate: "Due",
  description: "Description",
  quantity: "Qty",
  size: "Size",
  material: "Material",
  productionNotes: "Production Notes",
  internalNotes: "Internal Notes",
  ticketNote: "Note",
  jobId: "Job ID",
};

function fmt(
  partial: Partial<TicketFieldFormat> & { order: number },
): TicketFieldFormat {
  return {
    show: true,
    labelOverride: null,
    fontSize: "normal",
    fontWeight: "normal",
    align: "left",
    dividerBefore: false,
    dividerAfter: false,
    ...partial,
  };
}

/**
 * Default ticket template. Emphasis defaults per spec:
 *  - Order #: extra large, bold (kept at the very top, below Rush)
 *  - PO #: directly under Order #
 *  - Customer: extra large, bold (equal visual priority to Order #)
 *  - Fulfillment + Station/Route: near the top for shop routing
 *  - Assigned To: hidden by default (Station/Route replaces it)
 *  - Due date: bold
 *  - Rush indicator: extra large, bold, centered (only renders when rush)
 */
export const DEFAULT_TICKET_TEMPLATE: TicketTemplate = {
  version: 2,
  fields: {
    rush: fmt({ order: 0, fontSize: "xlarge", fontWeight: "bold", align: "center", dividerAfter: true }),
    orderNumber: fmt({ order: 1, fontSize: "xlarge", fontWeight: "bold" }),
    poNumber: fmt({ order: 2, fontWeight: "bold" }),
    customerName: fmt({ order: 3, fontSize: "xlarge", fontWeight: "bold" }),
    contactName: fmt({ order: 4, fontWeight: "bold" }),
    fulfillment: fmt({ order: 5, fontWeight: "bold" }),
    stationRoute: fmt({ order: 6, fontWeight: "bold" }),
    assignedTo: fmt({ order: 7, show: false }),
    dueDate: fmt({ order: 8, fontWeight: "bold", dividerAfter: true }),
    description: fmt({ order: 9, fontSize: "large", fontWeight: "bold" }),
    quantity: fmt({ order: 10, fontSize: "large", fontWeight: "bold" }),
    size: fmt({ order: 11, fontSize: "large", fontWeight: "bold" }),
    material: fmt({ order: 12, fontSize: "large", fontWeight: "bold" }),
    productionNotes: fmt({ order: 13, fontWeight: "bold", dividerBefore: true }),
    internalNotes: fmt({ order: 14, fontWeight: "bold" }),
    ticketNote: fmt({ order: 15, fontWeight: "bold", dividerBefore: true }),
    jobId: fmt({ order: 16, align: "center", dividerBefore: true }),
  },
};

/** Raw values pulled from the backend, before template formatting. */
export interface TicketSourceData {
  jobId: string;
  orderId: string;
  orderNumber: string;
  poNumber?: string | null;
  customerName: string;
  contactName?: string | null;
  /** Fulfillment method — e.g. "Pickup", "Delivery", "Shipping". */
  fulfillment?: string | null;
  /** Production station / route — e.g. "Prepress", "Flatbed", "Roll". */
  stationRoute?: string | null;
  assignedTo?: string | null;
  dueDate?: string | null; // ISO string
  priority?: string | null;
  description: string;
  quantity: number;
  /**
   * Print-only override for the displayed quantity (e.g. "150 of 200").
   * When set, it replaces the numeric quantity on the ticket without mutating
   * the underlying job/line-item data.
   */
  quantityDisplay?: string | null;
  size?: string | null;
  material?: string | null;
  productionNotes?: string | null;
  internalNotes?: string | null;
  /** Print-only ad-hoc note entered in the Print Options modal. */
  ticketNote?: string | null;
  reprintCount?: number;
  stationKey?: string | null;
}

/** One renderable line on the ticket. */
export interface TicketRow {
  key: TicketFieldKey;
  label: string;
  value: string;
  format: TicketFieldFormat;
}

/** Fully-resolved ticket, ready to render. */
export interface TicketData {
  jobId: string;
  orderId: string;
  isRush: boolean;
  reprintCount: number;
  rows: TicketRow[];
}

/** Optional fields are dropped from the ticket when they have no value. */
const OPTIONAL_FIELDS: ReadonlySet<TicketFieldKey> = new Set<TicketFieldKey>([
  "poNumber",
  "contactName",
  "fulfillment",
  "stationRoute",
  "assignedTo",
  "productionNotes",
  "internalNotes",
  "ticketNote",
]);

const EM_DASH = "—";

const FONT_SIZE_RANK: Record<TicketFontSize, number> = {
  small: 0,
  normal: 1,
  large: 2,
  xlarge: 3,
};

const THERMAL_MIN_FONT_SIZE_BY_FIELD: Partial<Record<TicketFieldKey, TicketFontSize>> = {
  rush: "xlarge",
  orderNumber: "xlarge",
  customerName: "xlarge",
  description: "large",
  quantity: "large",
  size: "large",
  material: "large",
};

function thermalReadableFontSize(key: TicketFieldKey, requested: TicketFontSize): TicketFontSize {
  const minimum = THERMAL_MIN_FONT_SIZE_BY_FIELD[key] ?? "normal";
  return FONT_SIZE_RANK[requested] >= FONT_SIZE_RANK[minimum] ? requested : minimum;
}

/**
 * Format an ISO date as a compact, locale-independent ticket date
 * (e.g. "May 22, 2026"). Returns "" for missing/invalid input.
 */
export function formatTicketDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function isRushPriority(priority: string | null | undefined): boolean {
  return String(priority || "").trim().toLowerCase() === "rush";
}

/** Resolve the raw string value for a single field. */
function rawValueFor(key: TicketFieldKey, src: TicketSourceData, isRush: boolean): string {
  switch (key) {
    case "orderNumber":
      return String(src.orderNumber || "").trim();
    case "rush":
      return isRush ? "RUSH" : "";
    case "poNumber":
      return String(src.poNumber || "").trim();
    case "customerName":
      return String(src.customerName || "").trim();
    case "contactName":
      return String(src.contactName || "").trim();
    case "fulfillment":
      return String(src.fulfillment || "").trim();
    case "stationRoute":
      return String(src.stationRoute || "").trim();
    case "assignedTo":
      return String(src.assignedTo || "").trim();
    case "dueDate":
      return formatTicketDate(src.dueDate);
    case "description":
      return String(src.description || "").trim();
    case "quantity": {
      const override = String(src.quantityDisplay || "").trim();
      if (override) return override;
      return Number.isFinite(src.quantity) ? String(src.quantity) : "";
    }
    case "size":
      return String(src.size || "").trim();
    case "material":
      return String(src.material || "").trim();
    case "productionNotes":
      return String(src.productionNotes || "").trim();
    case "internalNotes":
      return String(src.internalNotes || "").trim();
    case "ticketNote":
      return String(src.ticketNote || "").trim();
    case "jobId":
      return String(src.jobId || "").trim();
    default:
      return "";
  }
}

/**
 * Shared row assembler used by both the production ticket and the order
 * traveler. Applies template visibility/formatting and ordering to a set of
 * field keys.
 *
 * Rules:
 *  - Hidden fields (`show: false`) are excluded.
 *  - The `rush` field only appears when the job/order is actually rush.
 *  - Optional fields with no value are dropped; other fields keep an em-dash
 *    placeholder so the layout stays predictable.
 *  - Rows are ordered by `format.order`, ties broken by canonical field order.
 */
function assembleRows(
  keys: readonly TicketFieldKey[],
  template: TicketTemplate,
  getValue: (key: TicketFieldKey) => string,
  isRush: boolean,
): TicketRow[] {
  const rows: TicketRow[] = [];
  for (const key of keys) {
    const templateFormat = template.fields[key];
    if (!templateFormat || !templateFormat.show) continue;
    const format: TicketFieldFormat = {
      ...templateFormat,
      fontSize: thermalReadableFontSize(key, templateFormat.fontSize),
    };
    if (key === "rush" && !isRush) continue;

    const value = getValue(key);
    if (!value && OPTIONAL_FIELDS.has(key)) continue;
    if (key === "rush" && !value) continue;

    const labelOverride = (format.labelOverride || "").trim();
    rows.push({
      key,
      label: labelOverride || TICKET_FIELD_LABELS[key],
      value: value || EM_DASH,
      format,
    });
  }

  const canonicalIndex = (k: TicketFieldKey) => TICKET_FIELD_ORDER.indexOf(k);
  rows.sort((a, b) => {
    if (a.format.order !== b.format.order) return a.format.order - b.format.order;
    return canonicalIndex(a.key) - canonicalIndex(b.key);
  });
  return rows;
}

/**
 * Map raw ticket source data + a template into ordered, renderable rows for a
 * single production job / line item ticket.
 */
export function buildTicketData(
  src: TicketSourceData,
  template: TicketTemplate = DEFAULT_TICKET_TEMPLATE,
): TicketData {
  const isRush = isRushPriority(src.priority);
  const rows = assembleRows(
    TICKET_FIELD_ORDER,
    template,
    (key) => rawValueFor(key, src, isRush),
    isRush,
  );

  return {
    jobId: src.jobId,
    orderId: src.orderId,
    isRush,
    reprintCount: Number(src.reprintCount) || 0,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Order Traveler — whole-order summary with all line items.
// Reuses the same template + field formatting for the order-level header, then
// lists each line item in a compact table below.
// ---------------------------------------------------------------------------

/** Raw per-line-item values for an order traveler, before formatting. */
export interface TravelerLineItemSource {
  description: string;
  quantity: number;
  size?: string | null;
  material?: string | null;
  productionNotes?: string | null;
}

/** Raw order-level values for an order traveler. */
export interface OrderTravelerSource {
  orderId: string;
  orderNumber: string;
  /** Customer-provided PO or job-request reference. */
  poNumber?: string | null;
  customerName: string;
  contactName?: string | null;
  dueDate?: string | null;
  priority?: string | null;
  internalNotes?: string | null;
  lineItems: TravelerLineItemSource[];
}

/** One resolved line-item row on the traveler. */
export interface TravelerLineItem {
  index: number;
  description: string;
  quantity: string;
  size: string;
  material: string;
  productionNotes: string;
}

/** Fully-resolved order traveler, ready to render. */
export interface OrderTravelerData {
  orderId: string;
  orderNumber: string;
  isRush: boolean;
  headerRows: TicketRow[];
  lineItems: TravelerLineItem[];
  lineItemCount: number;
  totalQuantity: number;
}

/** Order-level header fields shown at the top of an order traveler. */
export const TRAVELER_HEADER_FIELDS: TicketFieldKey[] = [
  "rush",
  "orderNumber",
  "poNumber",
  "customerName",
  "contactName",
  "dueDate",
  "internalNotes",
];

/**
 * Map raw order data + a template into a renderable order traveler: a formatted
 * order-level header (reusing the ticket template) plus a list of line items.
 */
export function buildOrderTravelerData(
  src: OrderTravelerSource,
  template: TicketTemplate = DEFAULT_TICKET_TEMPLATE,
): OrderTravelerData {
  const isRush = isRushPriority(src.priority);

  const headerValue = (key: TicketFieldKey): string => {
    switch (key) {
      case "rush":
        return isRush ? "RUSH" : "";
      case "orderNumber":
        return String(src.orderNumber || "").trim();
      case "poNumber":
        return String(src.poNumber || "").trim();
      case "customerName":
        return String(src.customerName || "").trim();
      case "contactName":
        return String(src.contactName || "").trim();
      case "dueDate":
        return formatTicketDate(src.dueDate);
      case "internalNotes":
        return String(src.internalNotes || "").trim();
      default:
        return "";
    }
  };

  const headerRows = assembleRows(TRAVELER_HEADER_FIELDS, template, headerValue, isRush);

  const lineItems: TravelerLineItem[] = (src.lineItems || []).map((li, idx) => ({
    index: idx + 1,
    description: String(li.description || "").trim() || EM_DASH,
    quantity: Number.isFinite(li.quantity) ? String(li.quantity) : EM_DASH,
    size: String(li.size || "").trim() || EM_DASH,
    material: String(li.material || "").trim() || EM_DASH,
    productionNotes: String(li.productionNotes || "").trim(),
  }));

  return {
    orderId: src.orderId,
    orderNumber: src.orderNumber,
    isRush,
    headerRows,
    lineItems,
    lineItemCount: lineItems.length,
    totalQuantity: (src.lineItems || []).reduce(
      (sum, li) => sum + (Number.isFinite(li.quantity) ? li.quantity : 0),
      0,
    ),
  };
}
