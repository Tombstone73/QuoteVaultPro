import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { td, th } from "@/components/app/primitives";

export interface GridColumn<T> {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right";
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  cellClass?: string;
}

interface GridPrefs {
  order: string[];
  widths: Record<string, number>;
  sort?: { key: string; dir: "asc" | "desc" } | undefined;
}

function loadPrefs(id: string): GridPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`ph.grid.${id}`);
    return raw ? (JSON.parse(raw) as GridPrefs) : null;
  } catch {
    return null;
  }
}

export function WorkGrid<T>({
  id, columns, rows, rowKey, empty,
}: {
  id: string;
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
}) {
  const [prefs, setPrefs] = useState<GridPrefs>(() => ({
    order: columns.map((c) => c.key),
    widths: Object.fromEntries(columns.map((c) => [c.key, c.width])),
  }));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    const saved = loadPrefs(id);
    if (saved) {
      const known = columns.map((c) => c.key);
      const order = [...saved.order.filter((k) => known.includes(k)), ...known.filter((k) => !saved.order.includes(k))];
      setPrefs({ order, widths: { ...Object.fromEntries(columns.map((c) => [c.key, c.width])), ...saved.widths }, sort: saved.sort });
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(`ph.grid.${id}`, JSON.stringify(prefs));
    } catch { /* ignore */ }
  }, [id, prefs]);

  const byKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])) as Record<string, GridColumn<T>>, [columns]);
  const ordered = prefs.order.map((k) => byKey[k]).filter(Boolean) as GridColumn<T>[];

  const sorted = useMemo(() => {
    const s = prefs.sort;
    if (!s) return rows;
    const col = byKey[s.key];
    if (!col?.sortValue) return rows;
    const dir = s.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
  }, [rows, prefs.sort, byKey]);

  const toggleSort = (key: string) => {
    if (!byKey[key]?.sortValue) return;
    setPrefs((p) => ({
      ...p,
      sort: p.sort?.key === key ? (p.sort.dir === "asc" ? { key, dir: "desc" } : undefined) : { key, dir: "asc" },
    }));
  };

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    setPrefs((p0) => {
      const startW = p0.widths[key] ?? 120;
      const move = (ev: MouseEvent) => {
        const w = Math.max(56, startW + ev.clientX - startX);
        setPrefs((p) => ({ ...p, widths: { ...p.widths, [key]: w } }));
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return p0;
    });
  }, []);

  const onDrop = (target: string) => {
    if (!dragKey || dragKey === target) return;
    setPrefs((p) => {
      const order = p.order.filter((k) => k !== dragKey);
      order.splice(order.indexOf(target), 0, dragKey);
      return { ...p, order };
    });
    setDragKey(null);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {ordered.map((c) => <col key={c.key} style={{ width: prefs.widths[c.key] ?? c.width }} />)}
        </colgroup>
        <thead>
          <tr>
            {ordered.map((c) => (
              <th
                key={c.key}
                className={cn(th, "relative select-none", c.align === "right" && "text-right", c.sortValue && "cursor-pointer hover:text-foreground", dragKey === c.key && "opacity-50")}
                draggable
                onDragStart={() => setDragKey(c.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(c.key)}
                onDragEnd={() => setDragKey(null)}
                onClick={() => toggleSort(c.key)}
                title="Click to sort · drag to reorder · drag edge to resize"
              >
                <span className={cn("inline-flex items-center gap-1 truncate", c.align === "right" && "flex-row-reverse")}>
                  {c.label}
                  {prefs.sort?.key === c.key && (prefs.sort.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
                </span>
                <span
                  role="separator"
                  onMouseDown={(e) => startResize(c.key, e)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="row-h border-t border-border hover:bg-accent/60">
              {ordered.map((c) => (
                <td key={c.key} className={cn(td, "truncate", c.align === "right" && "text-right", c.cellClass)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td className="px-3 py-6 text-center text-[13px] text-muted-foreground" colSpan={ordered.length}>{empty ?? "Nothing here yet."}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
