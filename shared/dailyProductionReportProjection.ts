import { orderBusinessDatePart } from "./orderBusinessDate";
import { normalizeProductionStationKey } from "./productionStations";
import type {
  DailyProductionDestination,
  DailyProductionDueState,
  DailyProductionFulfillment,
  DailyProductionReport,
  DailyProductionReportRow,
} from "./dailyProductionReport";

export type DailyProductionReportSourceRow = {
  orderId: string;
  customerId?: string | null;
  orderNumber: string;
  displayNumber: string | null;
  jobNumber: number | null;
  label: string | null;
  poNumber: string | null;
  customerName: string | null;
  dueDate: string | null;
  shippingMethod: string | null;
  lineItemId: string | null;
  quantity: number | null;
  productionBypassed: boolean | null;
  isService: boolean | null;
  workflowIntent: string | null;
  defaultStationKey: string | null;
  jobStationKey: string | null;
};

/** Canonical, already-aggregated outstanding physical fulfillment work. */
export type DailyProductionFulfillmentSourceRow = {
  orderId: string;
  customerId: string | null;
  orderNumber: string;
  displayNumber: string | null;
  jobNumber: number | null;
  label: string | null;
  poNumber: string | null;
  customerName: string | null;
  dueDate: string | null;
  shippingMethod: string | null;
  remainingQuantity: number;
};

type Station = "roll" | "flatbed";

type LineSource = {
  quantity: number;
  productionBypassed: boolean;
  isService: boolean;
  workflowIntent: string | null;
  defaultStationKey: string | null;
  stations: Set<Station>;
};

type OrderSource = Omit<DailyProductionReportRow, "quantity" | "destination" | "dueState"> & {
  lines: Map<string, LineSource>;
};

const DUE_SORT_ORDER: Record<DailyProductionDueState, number> = {
  overdue: 0,
  today: 1,
  tomorrow: 2,
  future: 3,
  none: 4,
};

function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

export function getDailyProductionDueState(
  dueDate: string | null,
  asOf: string,
): DailyProductionDueState {
  if (!dueDate) return "none";
  if (dueDate < asOf) return "overdue";
  if (dueDate === asOf) return "today";
  if (dueDate === addCalendarDays(asOf, 1)) return "tomorrow";
  return "future";
}

function normalizeFulfillment(value: string | null): DailyProductionFulfillment {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "ship":
    case "shipping":
      return "Ship";
    case "pickup":
    case "pick_up":
      return "Pickup";
    case "deliver":
    case "delivery":
      return "Delivery";
    default:
      return "Unknown";
  }
}

function destinationFor(stations: Set<Station>, hasUnclassified: boolean): DailyProductionDestination {
  if (stations.size === 2) return "mixed";
  if (stations.has("roll")) return "roll";
  if (stations.has("flatbed")) return "flatbed";
  return hasUnclassified ? "unclassified" : "none";
}

export function sortDailyProductionRows(rows: DailyProductionReportRow[]): DailyProductionReportRow[] {
  return [...rows].sort((left, right) =>
    DUE_SORT_ORDER[left.dueState] - DUE_SORT_ORDER[right.dueState]
    || (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
    || left.orderNumber.localeCompare(right.orderNumber, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** Pure projection over one tenant-scoped joined query. It deliberately performs no I/O. */
export function buildDailyProductionReport(input: {
  organizationName: string;
  asOf: string;
  timezone: string;
  rows: DailyProductionReportSourceRow[];
  fulfillmentRows?: DailyProductionFulfillmentSourceRow[];
}): DailyProductionReport {
  const ordersById = new Map<string, OrderSource>();

  for (const row of input.rows) {
    let order = ordersById.get(row.orderId);
    if (!order) {
      order = {
        orderId: row.orderId,
        customerId: row.customerId ?? null,
        orderNumber: row.displayNumber || row.orderNumber || (row.jobNumber ? String(row.jobNumber) : "—"),
        customerName: row.customerName?.trim() || "Unknown customer",
        jobLabel: row.label?.trim() || null,
        poNumber: row.poNumber?.trim() || null,
        dueDate: orderBusinessDatePart(row.dueDate),
        fulfillment: normalizeFulfillment(row.shippingMethod),
        lines: new Map(),
      };
      ordersById.set(row.orderId, order);
    }

    if (!row.lineItemId) continue;
    let line = order.lines.get(row.lineItemId);
    if (!line) {
      line = {
        quantity: Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0,
        productionBypassed: Boolean(row.productionBypassed),
        isService: Boolean(row.isService),
        workflowIntent: row.workflowIntent,
        defaultStationKey: row.defaultStationKey,
        stations: new Set(),
      };
      order.lines.set(row.lineItemId, line);
    }

    const station = normalizeProductionStationKey(row.jobStationKey);
    if (station) line.stations.add(station);
  }

  const overview: DailyProductionReportRow[] = [];
  const roll: DailyProductionReportRow[] = [];
  const flatbed: DailyProductionReportRow[] = [];
  const fulfillment: DailyProductionReportRow[] = [];
  let unclassifiedProductionLines = 0;
  let nonstandardFulfillmentOrders = 0;

  for (const order of ordersById.values()) {
    const orderStations = new Set<Station>();
    let hasUnclassified = false;
    let quantity = 0;
    let rollQuantity = 0;
    let flatbedQuantity = 0;

    for (const line of order.lines.values()) {
      const isProduction = !line.productionBypassed
        && !line.isService
        && line.workflowIntent !== "fulfillment_only"
        && line.workflowIntent !== "service_fee";
      if (!isProduction) continue;

      if (line.stations.size === 0) {
        const fallback = normalizeProductionStationKey(line.defaultStationKey);
        if (fallback) line.stations.add(fallback);
      }

      quantity += line.quantity;
      if (line.stations.size === 0) {
        hasUnclassified = true;
        unclassifiedProductionLines += 1;
        continue;
      }

      for (const station of line.stations) {
        orderStations.add(station);
        if (station === "roll") rollQuantity += line.quantity;
        if (station === "flatbed") flatbedQuantity += line.quantity;
      }
    }

    const base: DailyProductionReportRow = {
      orderId: order.orderId,
      customerId: order.customerId,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      jobLabel: order.jobLabel,
      poNumber: order.poNumber,
      dueDate: order.dueDate,
      dueState: getDailyProductionDueState(order.dueDate, input.asOf),
      quantity,
      destination: destinationFor(orderStations, hasUnclassified),
      fulfillment: order.fulfillment,
    };

    if (base.fulfillment === "Unknown") nonstandardFulfillmentOrders += 1;
    overview.push(base);
    if (rollQuantity > 0) roll.push({ ...base, quantity: rollQuantity, destination: "roll" });
    if (flatbedQuantity > 0) flatbed.push({ ...base, quantity: flatbedQuantity, destination: "flatbed" });
  }

  const sortedOverview = sortDailyProductionRows(overview);
  for (const row of input.fulfillmentRows ?? []) {
    const quantity = Math.max(0, Number(row.remainingQuantity) || 0);
    if (quantity <= 0) continue;
    const dueDate = orderBusinessDatePart(row.dueDate);
    fulfillment.push({
      orderId: row.orderId,
      customerId: row.customerId,
      orderNumber: row.displayNumber || row.orderNumber || (row.jobNumber ? String(row.jobNumber) : "—"),
      customerName: row.customerName?.trim() || "Unknown customer",
      jobLabel: row.label?.trim() || null,
      poNumber: row.poNumber?.trim() || null,
      dueDate,
      dueState: getDailyProductionDueState(dueDate, input.asOf),
      quantity,
      destination: "none",
      fulfillment: normalizeFulfillment(row.shippingMethod),
    });
  }
  return {
    organizationName: input.organizationName,
    asOf: input.asOf,
    timezone: input.timezone,
    summary: {
      open: sortedOverview.length,
      dueToday: sortedOverview.filter((row) => row.dueState === "today").length,
      dueTomorrow: sortedOverview.filter((row) => row.dueState === "tomorrow").length,
      overdue: sortedOverview.filter((row) => row.dueState === "overdue").length,
      noDueDate: sortedOverview.filter((row) => row.dueState === "none").length,
    },
    overview: sortedOverview,
    roll: sortDailyProductionRows(roll),
    flatbed: sortDailyProductionRows(flatbed),
    fulfillment: sortDailyProductionRows(fulfillment),
    diagnostics: {
      unclassifiedProductionLines,
      mixedOrders: sortedOverview.filter((row) => row.destination === "mixed").length,
      nonstandardFulfillmentOrders,
      activeOrdersOutsideReportStatus: 0,
    },
  };
}
