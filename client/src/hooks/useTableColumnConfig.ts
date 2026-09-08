import * as React from "react";

export type ColumnConfig = {
  id: string;
  label: string;
  visible: boolean;
  order: number;
  /** Required identity/action columns must remain available. */
  locked?: boolean;
};

function sortByOrder(a: ColumnConfig, b: ColumnConfig) {
  return a.order - b.order;
}

/**
 * Saved layouts are intentionally treated as a preference, not a schema.
 * Rebuild from today's canonical columns so removed columns cannot break a
 * table and newly released columns remain visible for existing operators.
 */
export function mergeTableColumnConfig(defaults: ColumnConfig[], saved: unknown): ColumnConfig[] {
  const baseline = defaults.map((column, index) => ({ ...column, order: index }));
  if (!Array.isArray(saved)) return baseline;

  const savedById = new Map(
    saved
      .filter((column): column is Partial<ColumnConfig> & { id: string } => Boolean(column && typeof column === "object" && typeof (column as ColumnConfig).id === "string"))
      .map((column) => [column.id, column]),
  );
  const savedOrder = baseline
    .filter((column) => savedById.has(column.id))
    .sort((left, right) => Number(savedById.get(left.id)?.order ?? left.order) - Number(savedById.get(right.id)?.order ?? right.order));
  const newColumns = baseline.filter((column) => !savedById.has(column.id));

  return [...savedOrder, ...newColumns].map((column, index) => {
    const prior = savedById.get(column.id);
    return {
      ...column,
      visible: column.locked ? true : typeof prior?.visible === "boolean" ? prior.visible : column.visible,
      order: index,
    };
  });
}

export function useTableColumnConfig(tableKey: string, defaults: ColumnConfig[]) {
  const storageKey = `tableConfig:${tableKey}`;

  const load = React.useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return mergeTableColumnConfig(defaults, JSON.parse(raw));
    } catch {}
    return mergeTableColumnConfig(defaults, null);
  }, [defaults, storageKey]);

  const [columns, setColumns] = React.useState<ColumnConfig[]>(load);

  React.useEffect(() => {
    setColumns(load());
  }, [load]);

  const persist = React.useCallback((next: ColumnConfig[]) => {
    setColumns(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  }, [storageKey]);

  const setColumnVisibility = React.useCallback((id: string, visible: boolean) => {
    persist(columns.map(c => c.id === id ? { ...c, visible: c.locked ? true : visible } : c));
  }, [columns, persist]);

  const moveColumn = React.useCallback((id: string, direction: "up" | "down") => {
    const sorted = [...columns].sort(sortByOrder);
    const idx = sorted.findIndex(c => c.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    if (a.locked || b.locked) return;
    const next = sorted.map(c => {
      if (c.id === a.id) return { ...c, order: b.order };
      if (c.id === b.id) return { ...c, order: a.order };
      return c;
    }).sort(sortByOrder);
    persist(next);
  }, [columns, persist]);

  const reset = React.useCallback(() => {
    const next = mergeTableColumnConfig(defaults, null);
    persist(next);
  }, [defaults, persist]);

  return {
    columns: columns.sort(sortByOrder),
    setColumnVisibility,
    moveColumn,
    reset,
    canMoveColumn: (id: string, direction: "up" | "down") => {
      const sorted = [...columns].sort(sortByOrder);
      const index = sorted.findIndex((column) => column.id === id);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      return index >= 0 && targetIndex >= 0 && targetIndex < sorted.length && !sorted[index].locked && !sorted[targetIndex].locked;
    },
  };
}
