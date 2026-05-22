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
  | "customerName"
  | "contactName"
  | "assignedTo"
  | "dueDate"
  | "description"
  | "quantity"
  | "size"
  | "material"
  | "productionNotes"
  | "internalNotes"
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
  "customerName",
  "contactName",
  "assignedTo",
  "dueDate",
  "description",
  "quantity",
  "size",
  "material",
  "productionNotes",
  "internalNotes",
  "jobId",
];

/** Default human-readable labels (overridable per template field). */
export const TICKET_FIELD_LABELS: Record<TicketFieldKey, string> = {
  orderNumber: "Order #",
  rush: "Rush",
  customerName: "Customer",
  contactName: "Contact",
  assignedTo: "Assigned To",
  dueDate: "Due",
  description: "Description",
  quantity: "Qty",
  size: "Size",
  material: "Material",
  productionNotes: "Production Notes",
  internalNotes: "Internal Notes",
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
 *  - Order #: extra large, bold
 *  - Customer: large, bold
 *  - Due date: bold
 *  - Rush indicator: extra large, bold, centered (only renders when rush)
 */
export const DEFAULT_TICKET_TEMPLATE: TicketTemplate = {
  version: 1,
  fields: {
    rush: fmt({ order: 0, fontSize: "xlarge", fontWeight: "bold", align: "center", dividerAfter: true }),
    orderNumber: fmt({ order: 1, fontSize: "xlarge", fontWeight: "bold" }),
    customerName: fmt({ order: 2, fontSize: "large", fontWeight: "bold" }),
    contactName: fmt({ order: 3 }),
    assignedTo: fmt({ order: 4, fontWeight: "bold" }),
    dueDate: fmt({ order: 5, fontWeight: "bold", dividerAfter: true }),
    description: fmt({ order: 6 }),
    quantity: fmt({ order: 7, fontSize: "large", fontWeight: "bold" }),
    size: fmt({ order: 8 }),
    material: fmt({ order: 9 }),
    productionNotes: fmt({ order: 10, dividerBefore: true }),
    internalNotes: fmt({ order: 11 }),
    jobId: fmt({ order: 12, fontSize: "small", align: "center", dividerBefore: true }),
  },
};

/** Raw values pulled from the backend, before template formatting. */
export interface TicketSourceData {
  jobId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  contactName?: string | null;
  assignedTo?: string | null;
  dueDate?: string | null; // ISO string
  priority?: string | null;
  description: string;
  quantity: number;
  size?: string | null;
  material?: string | null;
  productionNotes?: string | null;
  internalNotes?: string | null;
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
  "contactName",
  "assignedTo",
  "productionNotes",
  "internalNotes",
]);

const EM_DASH = "—";

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
    case "customerName":
      return String(src.customerName || "").trim();
    case "contactName":
      return String(src.contactName || "").trim();
    case "assignedTo":
      return String(src.assignedTo || "").trim();
    case "dueDate":
      return formatTicketDate(src.dueDate);
    case "description":
      return String(src.description || "").trim();
    case "quantity":
      return Number.isFinite(src.quantity) ? String(src.quantity) : "";
    case "size":
      return String(src.size || "").trim();
    case "material":
      return String(src.material || "").trim();
    case "productionNotes":
      return String(src.productionNotes || "").trim();
    case "internalNotes":
      return String(src.internalNotes || "").trim();
    case "jobId":
      return String(src.jobId || "").trim();
    default:
      return "";
  }
}

/**
 * Map raw ticket source data + a template into ordered, renderable rows.
 *
 * Rules:
 *  - Hidden fields (`show: false`) are excluded.
 *  - The `rush` field only appears when the job is actually rush.
 *  - Optional fields with no value are dropped; required fields keep an em-dash
 *    placeholder so the layout stays predictable for the operator.
 *  - Rows are ordered by `format.order`, ties broken by canonical field order.
 */
export function buildTicketData(
  src: TicketSourceData,
  template: TicketTemplate = DEFAULT_TICKET_TEMPLATE,
): TicketData {
  const isRush = isRushPriority(src.priority);

  const rows: TicketRow[] = [];
  for (const key of TICKET_FIELD_ORDER) {
    const format = template.fields[key];
    if (!format || !format.show) continue;
    if (key === "rush" && !isRush) continue;

    const value = rawValueFor(key, src, isRush);
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

  return {
    jobId: src.jobId,
    orderId: src.orderId,
    isRush,
    reprintCount: Number(src.reprintCount) || 0,
    rows,
  };
}
