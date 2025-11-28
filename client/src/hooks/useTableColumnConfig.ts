import * as React from "react";

export type ColumnConfig = {
  id: string;
  label: string;
  visible: boolean;
  order: number;
};

function sortByOrder(a: ColumnConfig, b: ColumnConfig) {
  return a.order - b.order;
}

export function useTableColumnConfig(tableKey: string, defaults: ColumnConfig[]) {
  const storageKey = `tableConfig:${tableKey}`;

  const [columns, setColumns] = React.useState<ColumnConfig[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as ColumnConfig[];
        return parsed.sort(sortByOrder);
      }
    } catch {}
    // normalize defaults with order
    return defaults.map((c, idx) => ({ ...c, order: c.order ?? idx })).sort(sortByOrder);
  });

  const persist = React.useCallback((next: ColumnConfig[]) => {
    setColumns(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  }, [storageKey]);

  const setColumnVisibility = React.useCallback((id: string, visible: boolean) => {
    persist(columns.map(c => c.id === id ? { ...c, visible } : c));
  }, [columns, persist]);

  const moveColumn = React.useCallback((id: string, direction: "up" | "down") => {
    const sorted = [...columns].sort(sortByOrder);
    const idx = sorted.findIndex(c => c.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    const next = sorted.map(c => {
      if (c.id === a.id) return { ...c, order: b.order };
      if (c.id === b.id) return { ...c, order: a.order };
      return c;
    }).sort(sortByOrder);
    persist(next);
  }, [columns, persist]);

  const reset = React.useCallback(() => {
    const next = defaults.map((c, idx) => ({ ...c, order: idx })).sort(sortByOrder);
    persist(next);
  }, [defaults, persist]);

  return {
    columns: columns.sort(sortByOrder),
    setColumnVisibility,
    moveColumn,
    reset,
  };
}
