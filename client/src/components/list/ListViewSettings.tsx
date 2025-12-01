import { type ColumnConfig } from "@/hooks/useListViewSettings";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GripVertical, Settings as SettingsIcon, ArrowUp, ArrowDown } from "lucide-react";

interface ListViewSettingsProps {
  columns: ColumnConfig[];
  onToggleVisibility: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onWidthChange: (id: string, width: number) => void;
}

export function ListViewSettings({
  columns,
  onToggleVisibility,
  onReorder,
  onWidthChange,
}: ListViewSettingsProps) {
  const move = (id: string, direction: -1 | 1) => {
    const idx = columns.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= columns.length) return;
    const next = [...columns];
    const [item] = next.splice(idx, 1);
    next.splice(newIdx, 0, item);
    onReorder(next.map((c) => c.id));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SettingsIcon className="w-4 h-4 mr-2" />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <h4 className="text-sm font-medium">List View Settings</h4>
          <p className="text-xs text-muted-foreground">
            Show, hide, reorder columns and adjust widths.
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {columns.map((col, idx) => (
              <div key={col.id} className="flex items-center justify-between gap-2 p-2 hover:bg-muted/50 rounded">
                <div className="flex items-center gap-2 flex-1">
                  <GripVertical className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <Checkbox
                    id={`col-${col.id}`}
                    checked={col.visible}
                    onCheckedChange={() => onToggleVisibility(col.id)}
                  />
                  <Label htmlFor={`col-${col.id}`} className="text-sm cursor-pointer flex-1">
                    {col.label}
                  </Label>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => move(col.id, -1)}
                    disabled={idx === 0}
                    title="Move up"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => move(col.id, 1)}
                    disabled={idx === columns.length - 1}
                    title="Move down"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </Button>
                  <Input
                    type="number"
                    className="h-7 w-16 text-xs"
                    value={col.width ?? ""}
                    onChange={(e) =>
                      onWidthChange(col.id, Number(e.target.value) || 0)
                    }
                    placeholder="auto"
                    title="Column width (px)"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
