import type { ColumnDefinition, ColumnSettings, ColumnState } from "@/components/titan";

export const ORDERS_ACTIONS_WIDTH = 112;

function stateFor(settings: ColumnSettings, column: ColumnDefinition): ColumnState {
  const state = settings[column.key];
  return state && typeof state === "object" && !Array.isArray(state)
    ? state as ColumnState
    : { visible: column.defaultVisible !== false, width: column.defaultWidth ?? 150 };
}

/**
 * Fits visible data columns into the actual table viewport while reserving the
 * pinned Actions strip.  It deliberately keeps column minimums: a very narrow
 * workspace may still scroll, but never by widening the page unnecessarily.
 */
export function resolveOrdersColumnWidths(
  columns: ColumnDefinition[],
  settings: ColumnSettings,
  viewportWidth: number,
  autoFit: boolean,
): Record<string, number> {
  const visible = columns.filter((column) => stateFor(settings, column).visible);
  const dataColumns = visible.filter((column) => column.key !== "actions");
  const actions = visible.find((column) => column.key === "actions");
  const normal = Object.fromEntries(visible.map((column) => [
    column.key,
    column.key === "actions" ? ORDERS_ACTIONS_WIDTH : stateFor(settings, column).width,
  ]));

  if (!autoFit || !actions || viewportWidth <= 0) return normal;

  const available = Math.max(0, viewportWidth - ORDERS_ACTIONS_WIDTH);
  const minimum = dataColumns.reduce((sum, column) => sum + (column.minWidth ?? 60), 0);
  const preferred = dataColumns.reduce((sum, column) => sum + stateFor(settings, column).width, 0);
  const widthByKey: Record<string, number> = { actions: ORDERS_ACTIONS_WIDTH };

  if (available <= minimum) {
    for (const column of dataColumns) widthByKey[column.key] = column.minWidth ?? 60;
    return widthByKey;
  }

  const distributable = available - minimum;
  const preferredGrowth = Math.max(1, preferred - minimum);
  const growth = Math.min(1, distributable / preferredGrowth);
  for (const column of dataColumns) {
    const min = column.minWidth ?? 60;
    const desired = stateFor(settings, column).width;
    widthByKey[column.key] = Math.floor(min + (desired - min) * growth);
  }

  return widthByKey;
}
