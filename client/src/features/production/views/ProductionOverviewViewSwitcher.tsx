import { CalendarDays, LayoutGrid, List } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ProductionOverviewViewMode = "board" | "calendar" | "list";

export function ProductionOverviewViewSwitcher({
  value,
  onChange,
}: {
  value: ProductionOverviewViewMode;
  onChange: (value: ProductionOverviewViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border p-1" aria-label="Production overview view">
      <Button variant={value === "board" ? "secondary" : "ghost"} size="sm" onClick={() => onChange("board")} className="h-8">
        <LayoutGrid className="mr-1.5 h-4 w-4" /> Board
      </Button>
      <Button variant={value === "calendar" ? "secondary" : "ghost"} size="sm" onClick={() => onChange("calendar")} className="h-8">
        <CalendarDays className="mr-1.5 h-4 w-4" /> Calendar
      </Button>
      <Button variant={value === "list" ? "secondary" : "ghost"} size="sm" onClick={() => onChange("list")} className="h-8">
        <List className="mr-1.5 h-4 w-4" /> List
      </Button>
    </div>
  );
}
