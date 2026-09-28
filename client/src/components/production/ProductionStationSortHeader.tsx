import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import type { ProductionStationPage } from "@/lib/productionBoard";
import {
  nextProductionStationSort,
  persistProductionStationSort,
  readProductionStationSort,
  type ProductionStationSort,
  type ProductionStationSortField,
} from "@/lib/productionStationSorting";

export function useProductionStationSort(station: ProductionStationPage) {
  const { user } = useAuth();
  const userId = user?.id;
  const [sort, setSort] = useState<ProductionStationSort | null>(
    () => userId ? readProductionStationSort(station, userId) : null,
  );

  useEffect(() => {
    setSort(userId ? readProductionStationSort(station, userId) : null);
  }, [station, userId]);

  const toggleSort = (field: ProductionStationSortField) => {
    const next = nextProductionStationSort(sort, field);
    setSort(next);
    if (userId) persistProductionStationSort(station, userId, next);
  };

  return { sort, toggleSort };
}

export function ProductionStationSortHeader({
  field,
  sort,
  onSort,
  children,
  className,
  align = "left",
}: {
  field: ProductionStationSortField;
  sort: ProductionStationSort | null;
  onSort: (field: ProductionStationSortField) => void;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const direction = sort?.field === field ? sort.direction : null;
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <TableHead className={className} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
      <button
        type="button"
        className={`flex min-h-11 w-full select-none items-center gap-1.5 text-left hover:text-titan-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${align === "right" ? "justify-end" : "justify-start"}`}
        onClick={() => onSort(field)}
        aria-label={`Sort by ${String(children)}, ${direction === "asc" ? "ascending; click for descending" : direction === "desc" ? "descending; click for ascending" : "click for ascending"}`}
      >
        <span>{children}</span><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
    </TableHead>
  );
}
