import { useEffect, useState } from "react";

export type ColumnConfig = {
  id: string;
  label: string;
  visible: boolean;
  width?: number;
};

export function useListViewSettings(key: string, defaultColumns: ColumnConfig[]) {
  const storageKey = `titanos:list:${key}`;

  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    if (typeof window === "undefined") return defaultColumns;
    
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return defaultColumns;
      
      const parsed = JSON.parse(stored) as ColumnConfig[];
      
      // Merge: keep stored settings but add any new columns from defaults
      const storedById = new Map(parsed.map((c) => [c.id, c]));
      return defaultColumns.map((col) => storedById.get(col.id) ?? col);
    } catch (error) {
      console.error("Failed to parse list settings:", error);
      return defaultColumns;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(columns));
    } catch (error) {
      console.error("Failed to save list settings:", error);
    }
  }, [storageKey, columns]);

  const toggleVisibility = (id: string) => {
    setColumns((cols) =>
      cols.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))
    );
  };

  const setColumnOrder = (orderedIds: string[]) => {
    setColumns((cols) => {
      const byId = new Map(cols.map((c) => [c.id, c]));
      return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
    });
  };

  const setColumnWidth = (id: string, width: number) => {
    setColumns((cols) =>
      cols.map((c) => (c.id === id ? { ...c, width } : c))
    );
  };

  return { columns, setColumns, toggleVisibility, setColumnOrder, setColumnWidth };
}
